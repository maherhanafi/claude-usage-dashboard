/** Small accessible "(i)" icon that reveals an explanation on hover or focus. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="infotip" tabIndex={0} role="note" aria-label={text}>
      <span className="infotip-mark" aria-hidden="true">
        i
      </span>
      <span className="infotip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
