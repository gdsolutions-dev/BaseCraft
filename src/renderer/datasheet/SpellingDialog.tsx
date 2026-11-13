// Home › Spelling: one misspelled word of a cell, its suggestions and the choices of Access's Spelling dialog (reduced).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpellWord } from '../../shared/spelling';

export type SpellAnswer = { action: 'ignore' } | { action: 'ignoreAll' } | { action: 'change'; text: string } | { action: 'changeAll'; text: string };

export function SpellingDialog({ text, word, suggestions, close }: { text: string; word: SpellWord; suggestions: string[]; close(a: SpellAnswer | null): void }) {
  const { t } = useTranslation();
  const [to, setTo] = useState(suggestions[0] ?? word.word);
  return (
    <div>
      <div className="modal-field"><span>{t('datasheet.spellNotFound')}</span></div>
      <div data-testid="spell-context" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', marginBottom: 8 }}>
        {text.slice(0, word.start)}<mark data-testid="spell-word">{word.word}</mark>{text.slice(word.end)}
      </div>
      <label className="modal-field">
        <span>{t('datasheet.spellChangeTo')}</span>
        <input data-testid="spell-change-to" value={to} spellCheck={false} autoFocus onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') close({ action: 'change', text: to }); }} />
      </label>
      <label className="modal-field">
        <span>{t('datasheet.spellSuggestions')}</span>
        <select data-testid="spell-suggestions" size={5} value="" onChange={(e) => setTo(e.target.value)}>
          {suggestions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="modal-buttons" style={{ flexWrap: 'wrap' }}>
        <button className="btn" data-testid="spell-ignore" onClick={() => close({ action: 'ignore' })}>{t('datasheet.spellIgnore')}</button>
        <button className="btn" data-testid="spell-ignore-all" onClick={() => close({ action: 'ignoreAll' })}>{t('datasheet.spellIgnoreAll')}</button>
        <button className="btn btn-primary" data-testid="spell-change" onClick={() => close({ action: 'change', text: to })}>{t('datasheet.spellChange')}</button>
        <button className="btn" data-testid="spell-change-all" onClick={() => close({ action: 'changeAll', text: to })}>{t('datasheet.spellChangeAll')}</button>
        <button className="btn" data-testid="spell-cancel" onClick={() => close(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}
