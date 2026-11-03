// Connexion à un serveur (C4 R10) : utilisateur et mot de passe d'une source serveur, demandés à la première lecture. Le mot de passe
// ne vit que dans le champ de cette boîte et dans la réponse à bridge.ts : jamais dans un état partagé, jamais journalisé.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LoginAnswer } from '../bridge';
import type { ModalApi } from './Modal';

type Info = { user: string; label: string; canRemember: boolean };

function LoginForm({ info, wrong, untrusted, close }: { info: Info; wrong: boolean; untrusted: boolean; close(v: LoginAnswer | null): void }) {
  const { t } = useTranslation();
  const [user, setUser] = useState(info.user);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const ok = user.length >= 1 && user.length <= 256 && password.length >= 1 && password.length <= 256;
  return (
    <form data-testid="login-dialog" onSubmit={(e) => { e.preventDefault(); if (ok) close({ user, password, remember: info.canRemember && remember }); }}>
      <p className="modal-message">{t('link.login.message', { label: info.label })}</p>
      {untrusted && <p className="modal-message" data-testid="login-untrusted">{t('link.login.untrusted')}</p>}
      <label className="modal-field">
        <span>{t('link.login.user')}</span>
        <input data-testid="login-user" autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
      </label>
      <label className="modal-field">
        <span>{t('link.login.password')}</span>
        <input data-testid="login-password" type="password" autoComplete="off" value={password} aria-invalid={wrong}
          onChange={(e) => setPassword(e.target.value)} />
        {wrong && <span className="modal-error" role="alert" data-testid="login-error">{t('link.login.wrong')}</span>}
      </label>
      <div className="modal-field">
        <label>
          <input type="checkbox" data-testid="login-remember" disabled={!info.canRemember} checked={info.canRemember && remember}
            onChange={(e) => setRemember(e.target.checked)} />
          {t('link.login.remember')}
        </label>
        {!info.canRemember && <span className="muted" data-testid="login-no-keyring">{t('link.login.noKeyring')}</span>}
      </div>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="login-ok" disabled={!ok}>{t('link.login.ok')}</button>
        <button type="button" className="btn" data-testid="login-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

/** The user name last typed per server key: a refused login asks again with it (never the password). */
const typed = new Map<string, string>();

/** The login dialog for the server of `key` (bridge.ts's login prompt); `wrong`: the previous answer was refused; `untrusted`: a
 *  pass-through of a file not trusted, its remembered password not used (C6 Task 8). Null: Cancel. */
export async function askLogin(modal: ModalApi, key: string, wrong: boolean, untrusted = false): Promise<LoginAnswer | null> {
  const info = await api.links.loginInfo(key);
  const a = await modal.custom<LoginAnswer>((close) => (
    <LoginForm info={{ ...info, user: typed.get(key) ?? info.user }} wrong={wrong} untrusted={untrusted} close={close} />
  ), { titleKey: 'link.login.title' });
  if (a) typed.set(key, a.user);
  return a;
}
