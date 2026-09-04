const BASE_URL = 'https://axrush.com/guides';

export function guideUrl(checkId: string, anchor?: string): string {
  return anchor ? `${BASE_URL}/${checkId}#${anchor}` : `${BASE_URL}/${checkId}`;
}
