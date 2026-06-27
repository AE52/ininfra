// GitHub project Pages serves under a sub-path; mirror next.config's basePath
// so plain <video>/<img> src attributes resolve correctly (Next only rewrites
// next/image and <Link>, not raw asset URLs).
export const BASE_PATH =
  process.env.NEXT_PUBLIC_BASE_PATH !== undefined
    ? process.env.NEXT_PUBLIC_BASE_PATH
    : "/ininfra";

export const withBase = (p: string): string => `${BASE_PATH}${p}`;
