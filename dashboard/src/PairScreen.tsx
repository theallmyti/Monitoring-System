import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { anyApi } from "convex/server";
import jsQR from "jsqr";

// Pair a computer by scanning the QR code its installer shows (docs/Flow.md §3), or typing the code.
// The signed-in user who confirms becomes the owner.

const QR_PREFIX = "PCMONITOR-PAIR:";
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

type PairingInfo = { name: string; os: string; state: "pending" | "confirmed" | "expired" };

function normalize(input: string) {
  return input.replace(QR_PREFIX, "").replace(/[\s-]/g, "").toUpperCase();
}

export function PairScreen({ token, initialCode, onDone }: { token: string; initialCode?: string; onDone: () => void }) {
  const [code, setCode] = useState(initialCode ? normalize(initialCode) : "");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useMutation(anyApi.dashboard.confirmPairing);
  const check = useMutation(anyApi.dashboard.checkPairingCode);
  // undefined: checking; null: not found. Checked once per code (wrong codes are counted).
  const [info, setInfo] = useState<PairingInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!code) return;
    let current = true;
    setInfo(undefined);
    setError(null);
    check({ token, code })
      .then((r) => current && setInfo(r as PairingInfo | null))
      .catch((e) => {
        if (!current) return;
        setInfo(null);
        setError(e instanceof ConvexError && typeof e.data === "string" ? e.data : null);
      });
    return () => {
      current = false;
    };
  }, [code, token, check]);

  if (result) {
    return (
      <main className="center">
        <div className="login" role="status">
          <h1>Paired</h1>
          <p>{result} is now linked. Its readings appear on the dashboard within a minute.</p>
          <button type="button" className="action" onClick={onDone}>Back to dashboard</button>
        </div>
      </main>
    );
  }

  if (code) {
    const osName = info?.os === "windows" ? "Windows" : info?.os === "linux" ? "Linux" : info?.os;
    return (
      <main className="center">
        <div className="login">
          <h1>Pair device</h1>
          {info === undefined && <p className="muted">Checking code {code}…</p>}
          {info === null && !error && <p className="err">Code {code} was not found. Check the code on the computer.</p>}
          {info && info.state === "expired" && <p className="err">This code has expired. Run pairing again on the computer.</p>}
          {info && info.state === "confirmed" && <p>This code was already used.</p>}
          {info && info.state === "pending" && (
            <>
              <p>
                Pair <b>{info.name}</b> ({osName}) with your PC Monitor?
              </p>
              <p className="muted small">Only confirm a computer you own. Code {code}.</p>
            </>
          )}
          {error && <p className="err">{error}</p>}
          <div className="row">
            {info?.state === "pending" && (
              <button
                type="button"
                className="action"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const r = (await confirm({ token, code })) as { name: string } | null;
                    if (r) setResult(r.name);
                    else setError("Pairing failed. The code may have expired; run pairing again on the computer.");
                  } catch (e) {
                    setError(
                      e instanceof ConvexError && typeof e.data === "string" && e.data.startsWith("Too many")
                        ? e.data
                        : "Pairing failed. The code may have expired; run pairing again on the computer.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Pairing…" : "Pair device"}
              </button>
            )}
            <button type="button" className="link" onClick={() => { setCode(""); setError(null); }}>
              Scan another code
            </button>
            <button type="button" className="link" onClick={onDone}>Cancel</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <div className="login">
        <h1>Pair device</h1>
        <p className="muted">Point the camera at the QR code shown on the computer.</p>
        <Scanner accept={(t) => t.startsWith(QR_PREFIX)} onCode={(c) => setCode(normalize(c))} />
        <form
          className="code-form"
          onSubmit={(e) => {
            e.preventDefault();
            const c = normalize(typed);
            if (CODE_PATTERN.test(c)) setCode(c);
            else setError("Enter the 6-character code shown on the computer.");
          }}
        >
          <label>
            Or type the code
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="ABC 123"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={8}
            />
          </label>
          <button type="submit" className="action">Continue</button>
        </form>
        {error && <p className="err">{error}</p>}
        <button type="button" className="link" onClick={onDone}>Cancel</button>
      </div>
    </main>
  );
}

// Camera QR scanner: reads frames into a canvas and decodes them with jsQR.
// `accept` decides which QR texts count (pairing codes, unlock links); others are ignored.
export function Scanner({ onCode, accept }: { onCode: (text: string) => void; accept: (text: string) => boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  // Latest callback without restarting the camera on every parent render.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const [status, setStatus] = useState<"starting" | "scanning" | "unavailable">("starting");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      const v = video.current;
      if (stopped || !v || !ctx) return;
      if (v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // The computer draws the QR light-on-dark, so try inverted images too.
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (found && acceptRef.current(found.data)) {
          onCodeRef.current(found.data);
          return;
        }
      }
      timer = window.setTimeout(scan, 250);
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        setStatus("scanning");
        scan();
      })
      .catch(() => setStatus("unavailable"));

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (status === "unavailable") {
    return <p className="muted small">Camera not available here. Type the code instead.</p>;
  }
  return (
    <div className="scanner">
      <video ref={video} muted playsInline aria-label="Camera view for scanning the QR code" />
      {status === "starting" && <p className="muted small">Starting camera…</p>}
    </div>
  );
}
