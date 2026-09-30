import type { Metadata } from 'next';
import { UploadWizard } from './upload-wizard';

export const metadata: Metadata = { title: '파일 올리기' };

export default function EvidenceUploadPage() {
  return <UploadWizard />;
}
