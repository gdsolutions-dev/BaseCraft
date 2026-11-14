// A caption with its shortcut key underlined (« &Nom » shows Nom with N underlined; « && » is an ampersand).
import { captionParts } from '../../shared/design/access-keys';

export function Caption({ text }: { text: string }) {
  const p = captionParts(text);
  return <>{p.before}{p.key && <u>{p.key}</u>}{p.after}</>;
}
