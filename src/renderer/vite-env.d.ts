/// <reference types="vite/client" />
import type { TranceApi } from '../shared/api';

declare global {
  interface Window {
    trance: TranceApi;
  }
}
