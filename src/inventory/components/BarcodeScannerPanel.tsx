import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

interface DetectedBarcodeLike {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorConstructorLike {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

const SUPPORTED_FORMATS = [
  'code_128',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_39',
  'itf',
];

function getBarcodeDetectorConstructor(): BarcodeDetectorConstructorLike | null {
  const globalRecord = globalThis as unknown as {
    BarcodeDetector?: BarcodeDetectorConstructorLike;
  };
  return typeof globalRecord.BarcodeDetector === 'function'
    ? globalRecord.BarcodeDetector
    : null;
}

function mapCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) {
    const name = error.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Camera permission was denied. Allow camera access or enter the barcode manually / via USB scanner.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No camera was found on this device. Enter the barcode manually or use a USB scanner.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The camera is already in use by another application. Enter the barcode manually instead.';
    }
    if (name === 'SecurityError') {
      return 'Camera access requires a secure context (HTTPS or localhost). Enter the barcode manually instead.';
    }
  }
  return 'Unable to start camera scanning. Enter the barcode manually or use a USB scanner.';
}

export interface BarcodeScannerPanelProps {
  isLookingUp: boolean;
  lookupError: { message: string; requestId?: string | null } | null;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onLookupCode: (rawCode: string) => Promise<boolean>;
}

export function BarcodeScannerPanel({
  isLookingUp,
  lookupError,
  disabled = false,
  inputRef,
  onLookupCode,
}: BarcodeScannerPanelProps) {
  const barcodeInputId = useId();
  const barcodeHintId = useId();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedInputRef = inputRef ?? localInputRef;

  const [codeInput, setCodeInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const consumedScanRef = useRef(false);
  const mountedRef = useRef(true);

  const stopCameraTracks = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const closeCamera = useCallback(() => {
    stopCameraTracks();
    setCameraActive(false);
    setIsStartingCamera(false);
  }, [stopCameraTracks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCameraTracks();
    };
  }, [stopCameraTracks]);

  const triggerLookup = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setInputError('Scan or enter a barcode first.');
        resolvedInputRef.current?.focus();
        return;
      }
      setInputError(null);
      const shouldClear = await onLookupCode(trimmed);
      if (shouldClear && mountedRef.current) {
        setCodeInput('');
      }
    },
    [onLookupCode, resolvedInputRef],
  );

  useEffect(() => {
    if (!cameraActive || !streamRef.current) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = streamRef.current;
    const playPromise = video.play?.();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Ignore autoplay promise rejections if user closes view rapidly.
      });
    }

    const DetectorCtor = getBarcodeDetectorConstructor();
    if (!DetectorCtor) {
      return;
    }

    let detector: BarcodeDetectorLike;
    try {
      detector = new DetectorCtor({ formats: SUPPORTED_FORMATS });
    } catch {
      return;
    }

    let timerId: number | null = null;
    let scanningFrame = false;

    const scanTick = async () => {
      if (!mountedRef.current || consumedScanRef.current || scanningFrame) {
        return;
      }
      if (video.readyState < 2) {
        return;
      }
      scanningFrame = true;
      try {
        const results = await detector.detect(video);
        const match = results.find(
          (item) => typeof item.rawValue === 'string' && item.rawValue.trim().length > 0,
        );
        if (match?.rawValue && !consumedScanRef.current && mountedRef.current) {
          consumedScanRef.current = true;
          const scannedValue = match.rawValue.trim();
          closeCamera();
          setCodeInput(scannedValue);
          await triggerLookup(scannedValue);
        }
      } catch {
        // Ignore transient decode frame errors while camera is stabilizing.
      } finally {
        scanningFrame = false;
      }
    };

    timerId = window.setInterval(() => {
      void scanTick();
    }, 180);

    return () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
    };
  }, [cameraActive, closeCamera, triggerLookup]);

  const handleStartCamera = async () => {
    if (disabled || isStartingCamera) {
      return;
    }
    setCameraNotice(null);
    setInputError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCameraNotice(
        'Camera access is unavailable in this browser or connection. Enter the barcode manually or use a USB scanner.',
      );
      resolvedInputRef.current?.focus();
      return;
    }

    setIsStartingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      if (!mountedRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      if (!getBarcodeDetectorConstructor()) {
        setCameraNotice(
          'Camera preview started, but automatic barcode detection is not supported in this browser. Type the code or use a USB scanner below.',
        );
      }

      consumedScanRef.current = false;
      streamRef.current = stream;
      setCameraActive(true);
    } catch (error) {
      stopCameraTracks();
      setCameraActive(false);
      setCameraNotice(mapCameraErrorMessage(error));
      resolvedInputRef.current?.focus();
    } finally {
      if (mountedRef.current) {
        setIsStartingCamera(false);
      }
    }
  };

  const handleBarcodeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter') {
      // Intercept Enter from USB keyboard-style barcode scanners so the outer receipt form does not submit.
      event.preventDefault();
      event.stopPropagation();
      if (!disabled && !isLookingUp) {
        void triggerLookup(codeInput);
      }
    }
  };

  return (
    <section className="barcode-panel" aria-label="Barcode lookup and scanning">
      <div className="barcode-panel__header">
        <div>
          <h3 className="po-line-card__title">Scan or enter barcode</h3>
          <p className="catalog-field-hint" id={barcodeHintId}>
            Works with USB keyboard scanners (presses Enter automatically), manual entry preserving
            leading zeros, or phone camera scanning.
          </p>
        </div>
      </div>

      <div className="barcode-panel__controls" role="search" aria-label="Barcode lookup">
        <div className="barcode-panel__input-wrap">
          <label htmlFor={barcodeInputId} className="catalog-label">
            Barcode (supplier or internal)
          </label>
          <input
            ref={resolvedInputRef}
            id={barcodeInputId}
            name="barcodeLookup"
            type="text"
            inputMode="text"
            className="catalog-input"
            value={codeInput}
            onChange={(event) => {
              setCodeInput(event.target.value);
              if (inputError && event.target.value.trim()) {
                setInputError(null);
              }
            }}
            onKeyDown={handleBarcodeKeyDown}
            placeholder="e.g. 00890123456 or BGD00000001"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            disabled={disabled || isLookingUp}
            aria-invalid={inputError ? 'true' : 'false'}
            aria-describedby={barcodeHintId}
          />
        </div>

        <div className="barcode-panel__buttons">
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled || isLookingUp}
            aria-busy={isLookingUp}
            onClick={() => {
              void triggerLookup(codeInput);
            }}
          >
            {isLookingUp ? 'Looking up…' : 'Lookup barcode'}
          </button>

          {cameraActive ? (
            <button type="button" className="btn-secondary" onClick={closeCamera}>
              Stop camera
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled || isStartingCamera || isLookingUp}
              onClick={() => {
                void handleStartCamera();
              }}
            >
              {isStartingCamera ? 'Starting camera…' : 'Scan with camera'}
            </button>
          )}
        </div>
      </div>

      {inputError ? (
        <p className="catalog-field-error" role="alert">
          <span aria-hidden="true">!</span>
          <span>{inputError}</span>
        </p>
      ) : null}

      {lookupError ? (
        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{lookupError.message}</p>
            {lookupError.requestId ? (
              <p className="alert-banner__meta">Request ID: {lookupError.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {cameraNotice ? (
        <div className="alert-banner alert-banner--warning" role="alert">
          <div className="alert-banner__content">
            <p>{cameraNotice}</p>
          </div>
        </div>
      ) : null}

      {cameraActive ? (
        <div className="camera-scanner-box" aria-label="Camera barcode scanner">
          <div className="camera-scanner-box__header">
            <span className="po-line-card__title">Camera active — point at one barcode</span>
            <button type="button" className="btn-table-action" onClick={closeCamera}>
              Cancel scan
            </button>
          </div>
          <video
            ref={videoRef}
            className="camera-scanner-box__video"
            playsInline
            muted
            aria-label="Live camera preview for barcode scanning"
          />
          <p className="catalog-field-hint">
            One code is captured automatically per scan, or type the digits above if the tag is
            damaged.
          </p>
        </div>
      ) : null}
    </section>
  );
}
