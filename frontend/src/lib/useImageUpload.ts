import { useCallback, useRef, useState } from "react";
import { http } from "./api/http";

// ---------------------------------------------------------------------------
// useImageUpload
// ---------------------------------------------------------------------------
//
// Shared uploader for image fields in the app (avatars, brand logos, category
// images…). Picks a file, POSTs it to /system/uploads, and hands back the
// stored asset address for the owning record to save. There is no text URL
// input in the UI.
//
// R2 serves the object with immutable cache headers, so repeat views never
// re-download.

export interface ImageUploadState {
  uploading: boolean;
  error: string | null;
  upload: (file: File) => Promise<string | null>;
}

export function useImageUpload(): ImageUploadState {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const upload = useCallback(async (file: File): Promise<string | null> => {
    if (busy.current) return null;
    busy.current = true;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await http.upload<{ url: string }>("/system/uploads", body);
      return res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر رفع الصورة.");
      return null;
    } finally {
      busy.current = false;
      setUploading(false);
    }
  }, []);

  return { uploading, error, upload };
}

/** Builds the hidden <input type="file"> attrs for a label-based picker. */
export function useFilePicker(onPicked: (url: string | null) => void) {
  const { uploading, error, upload } = useImageUpload();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-picking the same file
      if (!file) return;
      const url = await upload(file);
      onPicked(url);
    },
    [upload, onPicked]
  );

  return { uploading, error, inputRef, openPicker, onChange };
}
