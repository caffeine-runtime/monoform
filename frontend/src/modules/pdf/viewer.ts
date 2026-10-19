// Import order matters: ./pdfjs sets globalThis.pdfjsLib, which the viewer
// components need at evaluation time.
import './pdfjs';
export { EventBus, PDFLinkService, PDFFindController, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
