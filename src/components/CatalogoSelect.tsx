import { useId, useRef, useState } from 'react';

type Props = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
};

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export default function CatalogoSelect({ options, value, onChange, label }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [active, setActive] = useState(0);
  const filtered = browse ? options : options.filter((option) => normalize(option).includes(normalize(value)));
  const choose = (option: string) => {
    onChange(option);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div className="catalogo-select" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <div className="catalogo-select-control">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          placeholder={`Digite ou selecione ${label.toLowerCase()}...`}
          value={value}
          onClick={() => { setBrowse(true); setActive(0); setOpen(true); }}
          onChange={(event) => { onChange(event.target.value); setBrowse(false); setActive(0); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setOpen(false); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) { setBrowse(true); setActive(0); setOpen(true); }
              else setActive((index) => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
            }
            if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (filtered[active]) choose(filtered[active]);
            }
          }}
        />
        <button type="button" className="catalogo-select-toggle" aria-label={`Abrir lista: ${label}`} aria-expanded={open}
          onClick={() => { input.current?.focus(); setBrowse(true); setActive(0); setOpen(!open); }}>
          ▾
        </button>
      </div>
      {open && (
        <div className="catalogo-select-list" role="listbox" id={`${id}-list`} aria-label={label}>
          {filtered.length === 0 && <div className="catalogo-select-empty" role="status">Nenhuma opção encontrada.</div>}
          {filtered.map((option, index) => (
            <div key={option} id={`${id}-option-${index}`} role="option" aria-selected={value === option}
              className={`catalogo-select-option${active === index ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
              ref={(element) => { if (active === index) element?.scrollIntoView({ block: 'nearest' }); }}>
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
