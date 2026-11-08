// Saves a file the browser holds as a Blob (an authenticated download made through the API client: a plain link would arrive without the sign-in and 401). Browser only.
export function saveBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
