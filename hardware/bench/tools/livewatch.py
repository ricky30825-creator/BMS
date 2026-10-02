# livewatch.py -- live view during a heat run. Run on the Pi (pipe it over ssh), Ctrl+C to stop.
#   Get-Content livewatch.py -Raw | ssh <USER>@<LAN_IP> "python3 -"
# Shows: IR 5a / 5b / max, ambient probe, V, A, and the 60 s IR rise (tempguard trips at >= 10 C
# per 60 s once IR >= 40 C, and at IR >= 55 C absolute). ASCII only so the stdin pipe is safe.
import os, re, sys, time, collections

HOME = os.path.expanduser("~")
WARN_C, TRIP_RATE, TRIP_GATE, STOP_C = 50.0, 10.0, 40.0, 55.0


def prefix():
    for ln in open(os.path.join(HOME, ".heat_run.state")):
        if ln.startswith("PREFIX="):
            return ln.strip().split("=", 1)[1]


def last_line(path, n=2048):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - n))
            lines = f.read().decode("utf-8", "ignore").strip().splitlines()
        return lines[-1] if lines else ""
    except Exception:
        return ""


def num(s):
    try:
        return float(s)
    except Exception:
        return None


def main():
    pfx = prefix()
    mlx = os.path.join(HOME, pfx + "_mlx01.csv")
    ina = os.path.join(HOME, pfx + "_ina.csv")
    tmp = os.path.join(HOME, "temp_logger.out")
    hist = collections.deque()
    print("livewatch  %s   (Ctrl+C to stop)" % pfx)
    print("time      5a     5b    max   amb    V      A     rise60  note")
    while True:
        now = time.time()
        m = last_line(mlx).split(",")
        a5 = num(m[2]) if len(m) > 6 else None
        b5 = num(m[4]) if len(m) > 6 else None
        mx = num(m[6]) if len(m) > 6 else None
        i = last_line(ina).split(",")
        v = num(i[2]) if len(i) > 3 else None
        a = num(i[3]) if len(i) > 3 else None
        # temp_logger.out line: "<time> t+N  cell= X  amb= Y  diff= Z  IR= W ..." -> values after each "="
        # (labels are Korean; match on the numbers only so the pipe stays ASCII-safe). amb is the 2nd one.
        vals = re.findall(r"=\s*(-?\d+\.\d+|--)", last_line(tmp))
        amb = num(vals[1]) if len(vals) >= 2 else None
        if mx is not None:
            hist.append((now, mx))
        while hist and now - hist[0][0] > 60:
            hist.popleft()
        rise = (mx - hist[0][1]) if (mx is not None and hist) else 0.0
        note = ""
        if mx is not None:
            if mx >= STOP_C - 3:
                note = "!!! NEAR %.0f C CUTOFF" % STOP_C
            elif mx >= WARN_C:
                note = "!!! WARN %.0f C - STOP HEATING" % WARN_C
            elif mx >= TRIP_GATE and rise >= TRIP_RATE * 0.7:
                note = "!! rise near trip (%.0f/60s)" % TRIP_RATE
        f = lambda x, w, d: ("%*.*f" % (w, d, x)) if x is not None else " " * (w - 2) + "--"
        sys.stdout.write("%s %s %s %s %s %s %s %s  %s%s\n" % (
            time.strftime("%H:%M:%S"), f(a5, 5, 1), f(b5, 5, 1), f(mx, 5, 1), f(amb, 5, 1),
            f(v, 5, 2), f(a, 6, 3), f(rise, 6, 1), note, "\a" if note.startswith("!!!") else ""))
        sys.stdout.flush()
        time.sleep(1.0)


try:
    main()
except KeyboardInterrupt:
    pass
