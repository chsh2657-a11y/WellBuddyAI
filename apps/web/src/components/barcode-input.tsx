'use client';

import { Camera, ScanBarcode } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** 브라우저 바코드 인식기(크롬·안드로이드 등). 없는 브라우저에서는 카메라 버튼을 숨긴다 */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const noSubscribe = () => () => undefined;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor && typeof navigator.mediaDevices?.getUserMedia === 'function' ? ctor : null;
}

/**
 * 바코드 입력(P3-13): USB·블루투스 스캐너는 키보드처럼 글자와 Enter 를 보내므로 입력칸에 바로 들어온다.
 * 카메라 버튼은 휴대폰·노트북 카메라로 읽는다.
 */
export function BarcodeInput({
  onScan,
  label = '바코드',
  disabled,
}: {
  onScan: (code: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  // 서버 렌더링에서는 알 수 없으므로 브라우저에서만 켠다
  const supported = useSyncExternalStore(
    noSubscribe,
    () => detectorCtor() !== null,
    () => false,
  );

  const submit = (code: string) => {
    const trimmed = code.trim();
    if (trimmed) onScan(trimmed);
    setValue('');
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-64">
        <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={label}
          className="pl-8"
          placeholder="바코드 스캔 또는 입력 후 Enter"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit(value);
            }
          }}
        />
      </div>
      {supported ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setCamera(true)}
        >
          <Camera />
          카메라
        </Button>
      ) : null}
      {camera ? (
        <CameraScanner
          onClose={() => setCamera(false)}
          onDetect={(code) => {
            setCamera(false);
            onScan(code);
          }}
        />
      ) : null}
    </div>
  );
}

function CameraScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const detector = new Ctor({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a'],
    });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        timer = setInterval(() => {
          if (!video.current) return;
          void detector
            .detect(video.current)
            .then((found) => {
              const code = found[0]?.rawValue;
              if (code && !stopped) {
                stopped = true;
                onDetect(code);
              }
            })
            .catch(() => undefined);
        }, 300);
      })
      .catch(() => setError('카메라를 열 수 없습니다. 브라우저의 카메라 권한을 확인해 주세요.'));
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>카메라로 바코드 읽기</DialogTitle>
          <DialogDescription>바코드를 화면 가운데에 맞추면 자동으로 읽습니다.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <video
            ref={video}
            className="aspect-video w-full rounded-md bg-black"
            muted
            playsInline
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
