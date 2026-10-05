#!/usr/bin/env python3
"""
Wheelhouse hardware helper.

Spawned by the desktop shell, it does the three things a sandboxed web page
cannot do with a steering wheel on Linux:

  * read it straight from /dev/input, so the wheel is there from the moment
    it is plugged in, with no need to touch it first (the browser's Gamepad
    API keeps controllers hidden until one is touched);
  * turn the rim, through a force-feedback spring whose centre is moved to
    wherever the rig's wheel is. The motor does the closed-loop work at its
    own rate, so this only has to move the target;
  * talk to Moza bases over their serial port, for the settings games cannot
    reach through HID: rotation range, FFB strength, temperatures.

Standard library only, so there is nothing to install. It speaks JSON lines:
commands in on stdin, events out on stdout.

The Moza serial protocol is the one documented by Boxflat
(https://github.com/Lawstorant/boxflat, GPL-3.0): moza-protocol.md and the
command table in data/serial.yml. This file implements the handful of
commands it needs from that description; it does not copy Boxflat's code.

Safety: force-feedback effects belong to the file descriptor that uploaded
them, and the kernel erases them when it is closed. If this process dies, for
any reason, the rim goes slack.
"""
import errno
import fcntl
import glob
import json
import math
import os
import select
import struct
import sys
import termios
import time

# ── evdev ioctls (linux/input.h) ────────────────────────────────────────────


def _ioc(direction, nr, size):
    return (direction << 30) | (size << 16) | (ord('E') << 8) | nr


_READ, _WRITE = 2, 1
EVIOCGID = _ioc(_READ, 0x02, 8)
EVIOCGEFFECTS = _ioc(_READ, 0x84, 4)
EVIOCSFF = _ioc(_WRITE, 0x80, 48)       # sizeof(struct ff_effect) on 64-bit
EVIOCRMFF = _ioc(_WRITE, 0x81, 4)


def EVIOCGNAME(n): return _ioc(_READ, 0x06, n)
def EVIOCGBIT(ev, n): return _ioc(_READ, 0x20 + ev, n)
def EVIOCGABS(code): return _ioc(_READ, 0x40 + code, 24)


EV_SYN, EV_KEY, EV_ABS, EV_FF = 0x00, 0x01, 0x03, 0x15
FF_SPRING, FF_DAMPER, FF_GAIN = 0x53, 0x55, 0x60

# Smoothing between the page's targets. The page sends a new target with
# each frame it draws — about 60 a second, and less when it is busy — and a
# spring moved in 60 steps a second pulls the rim along in little jerks.
# Here the spring's centre glides toward the latest target at this rate,
# with a time constant short enough to add no lag anyone can feel.
TICK = 1 / 250          # s
GLIDE_TAU = 0.015       # s
# A damper alongside the spring while the motor drives, as a fraction of the
# spring's strength: it soaks up the overshoot and wobble a spring alone
# leaves when it stops the rim somewhere.
DAMPING = 0.3
BTN_MISC = 0x100
EVENT = struct.Struct('llHHi')           # struct input_event, 24 bytes on 64-bit


def _bits(buf):
    return [i for i in range(len(buf) * 8) if buf[i // 8] >> (i % 8) & 1]


def condition_effect(kind, effect_id, centre, coeff_share, strength):
    """A spring or a damper: both are condition effects, laid out alike."""
    sat = int(0xFFFF * strength)
    coeff = int(0x7FFF * strength * coeff_share)
    centre = max(-32767, min(32767, int(centre * 32767)))
    cond = (sat, sat, coeff, coeff, 0, centre)
    return bytearray(struct.pack('<HhHHHHH2x' + 'HHhhHh' * 2 + '8x',
                                 kind, effect_id, 0, 0, 0, 0, 0, *cond, *cond))


def spring_effect(effect_id, centre, strength):
    """
    struct ff_effect carrying a spring.

    Layout: type, id, direction, trigger{button, interval},
    replay{length, delay}, two bytes of padding to align the union to 8, then
    condition[2] of {right_sat, left_sat, right_coeff, left_coeff, deadband,
    centre}, padded to the union's 32 bytes (its largest member holds a
    pointer). Only condition[0] matters for a wheel: that is the X axis.
    """
    sat = int(0xFFFF * strength)
    coeff = int(0x7FFF * strength)
    centre = max(-32767, min(32767, int(centre * 32767)))
    cond = (sat, sat, coeff, coeff, 0, centre)
    return bytearray(struct.pack('<HhHHHHH2x' + 'HHhhHh' * 2 + '8x',
                                 FF_SPRING, effect_id, 0, 0, 0, 0, 0, *cond, *cond))


class Joystick:
    """One /dev/input event device that reports as a joystick."""

    def __init__(self, link):
        self.link = link
        self.path = os.path.realpath(link)
        try:
            self.fd = os.open(self.path, os.O_RDWR | os.O_NONBLOCK)
            self.writable = True
        except PermissionError:
            self.fd = os.open(self.path, os.O_RDONLY | os.O_NONBLOCK)
            self.writable = False

        raw = fcntl.ioctl(self.fd, EVIOCGNAME(256), bytes(256))
        self.name = raw.split(b'\0')[0].decode(errors='replace') or 'joystick'
        _bus, self.vendor, self.product, _ver = struct.unpack(
            '4H', fcntl.ioctl(self.fd, EVIOCGID, bytes(8)))
        self.id = f'{self.name} (Vendor: {self.vendor:04x} Product: {self.product:04x})'

        # Axes in code order, so ABS_X — the rim on every wheel — is axis 0.
        self.abs_codes = [c for c in _bits(fcntl.ioctl(self.fd, EVIOCGBIT(EV_ABS, 8), bytes(8))) if c < 0x40]
        self.ranges = {}
        for code in self.abs_codes:
            _v, lo, hi, *_ = struct.unpack('6i', fcntl.ioctl(self.fd, EVIOCGABS(code), bytes(24)))
            self.ranges[code] = (lo, hi)
        self.axis_index = {c: i for i, c in enumerate(self.abs_codes)}
        self.axes = [0.0] * len(self.abs_codes)
        for code in self.abs_codes:
            v, *_ = struct.unpack('6i', fcntl.ioctl(self.fd, EVIOCGABS(code), bytes(24)))
            self._set_axis(code, v)

        self.key_codes = [c for c in _bits(fcntl.ioctl(self.fd, EVIOCGBIT(EV_KEY, 96), bytes(96))) if c >= BTN_MISC]
        self.key_index = {c: i for i, c in enumerate(self.key_codes)}
        self.buttons = [0] * len(self.key_codes)

        ff = _bits(fcntl.ioctl(self.fd, EVIOCGBIT(EV_FF, 16), bytes(16)))
        self.ff = self.writable and FF_SPRING in ff
        self.has_damper = self.writable and FF_DAMPER in ff
        self.effect_id = -1
        self.damper_id = -1
        # Where the page wants the spring, where it has glided to, and what
        # the base was last told — so an unchanged centre is not resent.
        self.setpoint = None
        self.glide = None
        self.sent = None
        self.strength = 0.0
        self.dirty = True
        self.sent_at = 0.0
        if self.ff:
            # Full gain: strength is set per effect, where it can be seen.
            self._write(EV_FF, FF_GAIN, 0xFFFF)

    def _set_axis(self, code, value):
        lo, hi = self.ranges[code]
        span = hi - lo
        self.axes[self.axis_index[code]] = 0.0 if span == 0 else (value - lo) / span * 2 - 1

    def _write(self, type_, code, value):
        os.write(self.fd, EVENT.pack(0, 0, type_, code, value))

    def describe(self):
        return {'id': self.id, 'name': self.name, 'path': self.link,
                'vendor': f'{self.vendor:04x}', 'product': f'{self.product:04x}',
                'axes': len(self.axes), 'buttons': len(self.buttons), 'ff': self.ff,
                # Which evdev axis each index is, so a known layout (Moza's,
                # as Boxflat records it) can be applied without guessing.
                'codes': self.abs_codes}

    def pump(self):
        """Drains pending events. Raises OSError if the device has gone."""
        while True:
            try:
                data = os.read(self.fd, EVENT.size * 64)
            except BlockingIOError:
                return
            for off in range(0, len(data) - EVENT.size + 1, EVENT.size):
                _s, _us, type_, code, value = EVENT.unpack_from(data, off)
                if type_ == EV_ABS and code in self.axis_index:
                    self._set_axis(code, value)
                    self.dirty = True
                elif type_ == EV_KEY and code in self.key_index:
                    self.buttons[self.key_index[code]] = 1 if value else 0
                    self.dirty = True

    def follow(self, centre, strength):
        """
        Sets where the spring should be. The first call uploads it at that
        centre and starts it playing, with a damper alongside; after that,
        `tick` glides the centre toward each new target.
        """
        if not self.ff:
            raise OSError(errno.EPERM, 'no force feedback on this device')
        self.setpoint = centre
        self.strength = strength
        if self.effect_id < 0:
            self.glide = centre
            self._upload(centre)
            self._start_damper()

    @property
    def driving(self):
        return self.effect_id >= 0

    def tick(self, dt):
        """Moves the spring's centre a step toward the target. Call often."""
        if self.effect_id < 0 or self.setpoint is None:
            return
        self.glide += (self.setpoint - self.glide) * (1 - math.exp(-dt / GLIDE_TAU))
        if abs(self.glide - self.setpoint) < 1e-5:
            self.glide = self.setpoint
        if self.sent is None or abs(self.glide - self.sent) > 2e-5 or self.glide == self.setpoint != self.sent:
            self._upload(self.glide)

    def _upload(self, centre):
        buf = spring_effect(self.effect_id, centre, self.strength)
        fcntl.ioctl(self.fd, EVIOCSFF, buf, True)
        if self.effect_id < 0:
            self.effect_id = struct.unpack_from('<h', buf, 2)[0]
            self._write(EV_FF, self.effect_id, 1)
        self.sent = centre

    def _start_damper(self):
        if not self.has_damper or self.damper_id >= 0:
            return
        try:
            buf = condition_effect(FF_DAMPER, -1, 0, DAMPING, self.strength)
            fcntl.ioctl(self.fd, EVIOCSFF, buf, True)
            self.damper_id = struct.unpack_from('<h', buf, 2)[0]
            self._write(EV_FF, self.damper_id, 1)
        except OSError:
            self.damper_id = -1          # the spring alone still works

    def release(self):
        for attr in ('effect_id', 'damper_id'):
            effect = getattr(self, attr)
            if effect < 0:
                continue
            try:
                self._write(EV_FF, effect, 0)
                fcntl.ioctl(self.fd, EVIOCRMFF, effect)
            except OSError:
                pass
            setattr(self, attr, -1)
        self.setpoint = self.glide = self.sent = None

    def close(self):
        self.release()
        try:
            os.close(self.fd)
        except OSError:
            pass


# ── Moza serial ─────────────────────────────────────────────────────────────

MOZA_START = 0x7E
MOZA_MAGIC = 13          # added into every checksum; see Boxflat's moza-protocol.md
MOZA_BASE = 19
# A wheel fitted to the base answers on one of these, to reads in group 64.
RIM_DEVICES = (23, 21)
RIM_READ = 64

# name: (read group, write group, command id, payload bytes, to device, from device)
MOZA_COMMANDS = {
    # The base stores half the lock-to-lock angle.
    'rotation': (40, 41, [1], 2, lambda deg: int(deg) // 2, lambda v: v * 2),
    'max-angle': (40, 41, [23], 2, lambda deg: int(deg) // 2, lambda v: v * 2),
    'ffb-strength': (40, 41, [2], 2, lambda pct: int(pct * 10), lambda v: v / 10),
    'torque': (40, 41, [18], 2, int, lambda v: v),
    'spring': (40, 41, [9], 2, int, lambda v: v),
    'damper': (40, 41, [7], 2, int, lambda v: v),
    'mcu-temp': (43, -1, [4], 2, int, lambda v: v / 100),
    'motor-temp': (43, -1, [6], 2, int, lambda v: v / 100),
}


def moza_message(group, device, cmd_id, payload):
    body = bytes([MOZA_START, len(cmd_id) + len(payload), group, device, *cmd_id]) + payload
    return body + bytes([(MOZA_MAGIC + sum(body)) % 256])


def _holders(path):
    """Other processes with this file open, by command line."""
    real = os.path.realpath(path)
    found = []
    for fd_dir in glob.glob('/proc/[0-9]*/fd'):
        pid = fd_dir.split('/')[2]
        if pid == str(os.getpid()):
            continue
        try:
            for fd in os.listdir(fd_dir):
                if os.readlink(os.path.join(fd_dir, fd)) == real:
                    with open(f'/proc/{pid}/cmdline', 'rb') as f:
                        found.append(f.read().replace(b'\0', b' ').decode(errors='replace').strip())
                    break
        except OSError:
            continue
    return found


def parse_frames(buffer):
    """
    Pulls whole replies out of a byte stream: start byte, length, group,
    device, command id and value, checksum. Anything else — torn frames, the
    base's own debug text — is skipped. Returns (frames, leftover bytes).
    """
    frames = []
    while True:
        start = buffer.find(bytes([MOZA_START]))
        if start < 0:
            return frames, b''
        buffer = buffer[start:]
        if len(buffer) < 2:
            return frames, buffer
        n = buffer[1]
        if not 1 <= n <= 11:
            buffer = buffer[1:]
            continue
        total = 2 + 2 + n + 1          # start, length, group, device, payload, checksum
        if len(buffer) < total:
            return frames, buffer
        frame = buffer[:total]
        if (MOZA_MAGIC + sum(frame[:-1])) % 256 != frame[-1]:
            buffer = buffer[1:]
            continue
        frames.append(frame)
        buffer = buffer[total:]


def decode_frames(frames, values):
    """Replies set the top bit of the group and swap the device id's nibbles."""
    changed = []
    for frame in frames:
        group, payload = frame[2] & 0x7F, frame[4:-1]
        for name, (read, write, cmd_id, size, _enc, decode) in MOZA_COMMANDS.items():
            if group in (read, write) and list(payload[:len(cmd_id)]) == cmd_id:
                raw = int.from_bytes(payload[len(cmd_id):len(cmd_id) + size], 'big')
                values[name] = decode(raw)
                changed.append(name)
                break
    return changed


class MozaBase:
    """A Moza wheelbase's serial port: settings and sensors games cannot reach."""

    def __init__(self):
        self.fd = None
        self.path = None
        self.state = 'absent'
        self.holder = None
        self.buffer = b''
        self.values = {}

    def check(self):
        """Finds the port and opens it, unless something else is using it."""
        path = self._path()
        if path is None:
            self.close()
            self.state, self.holder = 'absent', None
            return
        if self.fd is not None and path == self.path:
            # Step aside the moment anything else opens it — Boxflat coming
            # back, say. Two readers on one port corrupt each other's replies,
            # and the base's settings have already been read and kept.
            others = _holders(path)
            if others:
                self.close()
                self.state = 'busy'
                self.holder = 'Boxflat' if any('boxflat' in h for h in others) else others[0].split(' ')[0]
            return
        # Two readers on one tty split the replies between them and neither
        # gets a whole message. Boxflat holds the port while it runs, so step
        # aside rather than corrupt both.
        holders = _holders(path)
        if holders:
            self.close()
            self.state = 'busy'
            self.holder = 'Boxflat' if any('boxflat' in h for h in holders) else holders[0].split(' ')[0]
            return
        try:
            fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
            attrs = termios.tcgetattr(fd)
            attrs[0] = attrs[1] = attrs[3] = 0
            attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
            attrs[4] = attrs[5] = termios.B115200
            termios.tcsetattr(fd, termios.TCSANOW, attrs)
            termios.tcflush(fd, termios.TCIOFLUSH)
        except OSError as e:
            self.state, self.holder = 'error', str(e)
            return
        self.fd, self.path, self.state, self.holder = fd, path, 'ok', None

    def close(self):
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
        self.fd = None
        self.path = None

    def request(self, name, value=None):
        if self.fd is None or name not in MOZA_COMMANDS:
            return
        read, write, cmd_id, size, encode, _decode = MOZA_COMMANDS[name]
        if value is None:
            msg = moza_message(read, MOZA_BASE, cmd_id, (1).to_bytes(size, 'big'))
        elif write >= 0:
            msg = moza_message(write, MOZA_BASE, cmd_id, encode(value).to_bytes(size, 'big'))
        else:
            return
        try:
            os.write(self.fd, msg)
        except OSError:
            self.close()
            self.state = 'absent'

    def pump(self):
        """Reads replies. Returns the names whose values changed."""
        try:
            self.buffer += os.read(self.fd, 512)
        except BlockingIOError:
            return []
        except OSError:
            self.close()
            self.state = 'absent'
            return []
        frames, self.buffer = parse_frames(self.buffer)
        return decode_frames(frames, self.values)

    def shared_read(self, names=('rotation',)):
        """
        Asks the base for settings while another program holds its port.

        Boxflat opens the port shared, so the questions can still be sent;
        the replies are split between the two readers, but they arrive whole
        often enough, and the checksum throws out anything torn. Read-only,
        a few questions at a time, and the port's settings are left exactly
        as the other program set them. Returns the names that came back.
        """
        path = self._path()
        if path is None:
            return []
        try:
            fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        except OSError:
            return []
        got = set()
        buffer = b''
        try:
            for _ in range(8):
                for name in names:
                    if name in got or name not in MOZA_COMMANDS:
                        continue
                    read, _w, cmd_id, size, _e, _d = MOZA_COMMANDS[name]
                    os.write(fd, moza_message(read, MOZA_BASE, cmd_id, (1).to_bytes(size, 'big')))
                end = time.monotonic() + 0.06
                while time.monotonic() < end:
                    if select.select([fd], [], [], 0.01)[0]:
                        try:
                            buffer += os.read(fd, 512)
                        except BlockingIOError:
                            pass
                frames, buffer = parse_frames(buffer)
                got.update(decode_frames(frames, self.values))
                if all(n in got for n in names if n in MOZA_COMMANDS):
                    break
        except OSError:
            pass
        finally:
            os.close(fd)
        return sorted(got)

    def probe_rim(self, rounds=4):
        """
        Asks whether a wheel is fitted to the base, read-only: the rim answers
        on its own device id (23, or 21 on older rims) when it is there, as
        Boxflat finds it. True if one answered, False if none did, None if
        there is no port to ask. Some rims (Moza's ES among them) do not
        answer at all, so False means "not confirmed", never "safe".
        """
        path = self._path()
        if path is None:
            return None
        own = self.fd is not None
        try:
            fd = self.fd if own else os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        except OSError:
            return None
        # Reads only: telemetry mode and paddle mode, both group 64.
        asks = [moza_message(RIM_READ, dev, cid, (1).to_bytes(1, 'big'))
                for dev in RIM_DEVICES for cid in ([28, 0], [3])]
        replies = {((d & 0x0F) << 4) | (d >> 4) for d in RIM_DEVICES}
        found = False
        buffer = b''
        try:
            for _ in range(rounds):
                for msg in asks:
                    os.write(fd, msg)
                end = time.monotonic() + 0.08
                while time.monotonic() < end:
                    if select.select([fd], [], [], 0.01)[0]:
                        try:
                            buffer += os.read(fd, 512)
                        except BlockingIOError:
                            pass
                frames, buffer = parse_frames(buffer)
                if any(f[2] & 0x7F == RIM_READ and f[3] in replies for f in frames):
                    found = True
                    break
                # Anything else that came back is still the base's news.
                decode_frames(frames, self.values)
        except OSError:
            pass
        finally:
            if not own:
                os.close(fd)
        return found

    def _path(self):
        paths = sorted(p for p in glob.glob('/dev/serial/by-id/*') if 'gudsen' in p.lower() or 'moza' in p.lower())
        return next((p for p in paths if p.endswith('-if00')), paths[0] if paths else None)


# ── the loop ────────────────────────────────────────────────────────────────


def emit(message):
    sys.stdout.write(json.dumps(message, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def main():
    devices = {}            # link → Joystick
    moza = MozaBase()
    stdin_buf = b''
    last_scan = 0.0
    last_moza_poll = 0.0
    INPUT_INTERVAL = 1 / 125   # bases report at up to 1 kHz; the page renders at 60
    following = None
    last_tick = time.monotonic()

    def scan():
        nonlocal following
        links = set(glob.glob('/dev/input/by-id/*-event-joystick'))
        changed = False
        for link in list(devices):
            if link not in links or not os.path.exists(devices[link].path):
                devices.pop(link).close()
                changed = True
        for link in sorted(links - set(devices)):
            try:
                devices[link] = Joystick(link)
                changed = True
            except OSError as e:
                emit({'t': 'error', 'message': f'cannot open {link}: {e.strerror}'})
        if following and following not in {d.id for d in devices.values()}:
            following = None
        prior = (moza.state, moza.holder)
        moza.check()
        # While something else holds the port, the base is asked only when the
        # page asks — Calibrate — so Boxflat's connection is left alone.
        if changed:
            emit({'t': 'devices', 'list': [d.describe() for d in devices.values()]})
        if changed or prior != (moza.state, moza.holder):
            emit({'t': 'moza', 'state': moza.state, 'holder': moza.holder, 'values': moza.values})
            if moza.state == 'ok':
                for name in MOZA_COMMANDS:
                    moza.request(name)

    def by_id(dev_id):
        return next((d for d in devices.values() if d.id == dev_id), None)

    def command(msg):
        nonlocal following
        op = msg.get('op')
        if op == 'scan':
            emit({'t': 'devices', 'list': [d.describe() for d in devices.values()]})
            emit({'t': 'moza', 'state': moza.state, 'holder': moza.holder, 'values': moza.values})
        elif op == 'follow':
            dev = by_id(msg.get('id'))
            if dev is None:
                return
            strength = max(0.0, min(1.0, float(msg.get('strength', 0.3))))
            try:
                dev.follow(float(msg.get('centre', 0)), strength)
                if following != dev.id:
                    following = dev.id
                    emit({'t': 'ff', 'id': dev.id, 'state': 'following'})
            except OSError as e:
                emit({'t': 'ff', 'id': dev.id, 'state': 'error', 'message': e.strerror or str(e)})
        elif op == 'release':
            for dev in devices.values():
                dev.release()
            if following:
                emit({'t': 'ff', 'id': following, 'state': 'released'})
            following = None
        elif op == 'moza-read':
            names = msg.get('names') or list(MOZA_COMMANDS)
            if moza.state == 'busy':
                moza.shared_read(tuple(names))
                emit({'t': 'moza', 'state': moza.state, 'holder': moza.holder, 'values': moza.values})
            else:
                for name in names:
                    moza.request(name)
        elif op == 'rim-probe':
            emit({'t': 'rim', 'present': moza.probe_rim()})
        elif op == 'moza-write':
            name, value = msg.get('name'), msg.get('value')
            if name == 'rotation':
                # Boxflat writes both; the base honours the smaller.
                moza.request('rotation', value)
                moza.request('max-angle', value)
                moza.request('rotation')
            elif name in MOZA_COMMANDS:
                moza.request(name, value)
                moza.request(name)

    os.set_blocking(sys.stdin.fileno(), False)
    while True:
        now = time.monotonic()
        if now - last_scan > 1.0:
            scan()
            last_scan = now
        if moza.state == 'ok' and now - last_moza_poll > 2.0:
            moza.request('mcu-temp')
            moza.request('motor-temp')
            last_moza_poll = now

        fds = [sys.stdin.fileno()] + [d.fd for d in devices.values()]
        if moza.fd is not None:
            fds.append(moza.fd)
        try:
            # Short while anything is waiting to go out, so a throttled
            # update is not held back until the next event arrives.
            driving = any(d.driving for d in devices.values())
            wait = TICK if driving else 0.008 if any(d.dirty for d in devices.values()) else 0.05
            ready, _, _ = select.select(fds, [], [], wait)
        except (OSError, ValueError):
            last_scan = 0
            continue

        if sys.stdin.fileno() in ready:
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk:
                break                    # the shell went away: close everything and go
            stdin_buf += chunk
            *lines, stdin_buf = stdin_buf.split(b'\n')
            for line in lines:
                if line.strip():
                    try:
                        command(json.loads(line))
                    except (ValueError, TypeError) as e:
                        emit({'t': 'error', 'message': f'bad command: {e}'})

        if moza.fd is not None and moza.fd in ready:
            changed = moza.pump()
            if changed:
                emit({'t': 'moza', 'state': moza.state, 'holder': moza.holder, 'values': moza.values})

        tick_dt = now - last_tick
        last_tick = now
        for dev in devices.values():
            if dev.driving:
                try:
                    dev.tick(min(tick_dt, 0.05))
                except OSError as e:
                    emit({'t': 'ff', 'id': dev.id, 'state': 'error', 'message': e.strerror or str(e)})
                    dev.release()

        for link, dev in list(devices.items()):
            if dev.fd in ready:
                try:
                    dev.pump()
                except OSError:
                    devices.pop(link).close()
                    emit({'t': 'devices', 'list': [d.describe() for d in devices.values()]})
                    continue
            if dev.dirty and now - dev.sent_at >= INPUT_INTERVAL:
                emit({'t': 'input', 'id': dev.id,
                      'axes': [round(a, 5) for a in dev.axes],
                      'down': [i for i, b in enumerate(dev.buttons) if b]})
                dev.dirty = False
                dev.sent_at = now

    for dev in devices.values():
        dev.close()
    moza.close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
