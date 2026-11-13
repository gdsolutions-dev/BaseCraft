// Insert Hyperlink (D3, form and report designers): a small dialog (address, then the text to display) and the label that carries both.
// ponytail: two prompts in a row, not Access's one dialog with a tree of existing objects; a link is a label with a HyperlinkAddress.
import type { TFunction } from 'i18next';
import { safeUrl } from '../../shared/hyperlink';
import type { ModalApi } from '../shell/Modal';

/** The address (normalised, http:, https: or mailto:) and the text to display (the address when left empty); null when cancelled. */
export async function askHyperlink(modal: ModalApi, t: TFunction): Promise<{ address: string; text: string } | null> {
  const typed = await modal.prompt({ titleKey: 'ribbon.cmd.hyperlink', labelKey: 'hyperlink.address', initial: 'https://', validate: (v) => (safeUrl(v) ? null : t('hyperlink.invalid')) });
  const address = safeUrl(typed);
  if (address === null) return null;
  const text = await modal.prompt({ titleKey: 'ribbon.cmd.hyperlink', labelKey: 'hyperlink.text', initial: address });
  return text === null ? null : { address, text: text.trim() || address };
}
