import { Children, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { spriteUrl } from '../../assets/sprite-url';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'id'> & {
  kind: 'character' | 'weapon' | 'item'; id: string; glyph?: string;
  children?: ReactNode; style?: CSSProperties;
};

/** Same containing element and 3px image inset as the reference SpriteStore.apply. */
export function SpriteIcon({ kind, id, glyph, children, style, className = '', ...attributes }: Props) {
  const [loaded, setLoaded] = useState('');
  const [failed, setFailed] = useState('');
  let url: string | undefined;
  try { url = spriteUrl('./assets', kind, id); } catch { /* Keep the reference glyph fallback. */ }
  const visible = !!url && loaded === url && failed !== url;
  return <div {...attributes} data-sprite={`${kind}:${id}`} className={`${className}${visible ? ' has-sprite' : ''}`}
    style={{ position: 'relative', ...style }}>
    {glyph && <span className="glyph-auto">{glyph}</span>}
    {Children.map(children, child => typeof child === 'string' || typeof child === 'number'
      ? <span className="glyph-auto">{child}</span> : child)}
    {url && failed !== url && <img className="sprite-img" src={url} alt="" draggable={false}
      style={{ position: 'absolute', inset: 3, width: 'calc(100% - 6px)', height: 'calc(100% - 6px)', objectFit: 'contain', pointerEvents: 'none', imageRendering: 'auto' }}
      onLoad={() => setLoaded(url)} onError={() => setFailed(url)} />}
  </div>;
}
