// A label's HyperlinkAddress clicked in Form view (D3). The address came from the base's author, so it is checked here and again in the
// main process (http:, https: or mailto: only), and the user is asked before each address is opened for the first time.
import { safeUrl } from '../../shared/hyperlink';
import { api } from '../bridge';
import type { ModalApi } from '../shell/Modal';

/** The addresses the user agreed to open since the app started. ponytail: asked once per address for the whole session, trusted base or not
 *  (a stricter rule than trust.ts, which governs active content); remember per base if it proves tiresome. */
const agreed = new Set<string>();

/** Opens `address` in the system browser or mail client; false when it was refused (not a web or mail address) or declined. */
export async function openHyperlink(modal: ModalApi, address: string): Promise<boolean> {
  const url = safeUrl(address);
  if (url === null) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'hyperlink.invalid', buttons: ['ok'] }); return false; }
  if (!agreed.has(url)) {
    if (await modal.confirm({ titleKey: 'ribbon.cmd.hyperlink', messageKey: 'hyperlink.open', params: { url }, buttons: ['yes', 'no'], defaultButton: 'no' }) !== 'yes') return false;
    agreed.add(url);
  }
  await api.app.openHyperlink(url);
  return true;
}
