export function AspectRatioField({ value = '16:9' }: { value?: string }) {
  const ratios = [
    ['16:9', '横屏'],
    ['9:16', '竖屏'],
    ['1:1', '方形'],
    ['4:3', '经典'],
    ['2.35:1', '宽银幕'],
  ];
  return (
    <fieldset className="ratio-field">
      <legend>画幅</legend>
      <div className="ratio-options">
        {ratios.map(([ratio, title]) => (
          <label className="ratio-option" key={ratio}>
            <input type="radio" name="aspectRatio" value={ratio} defaultChecked={value === ratio} />
            <span className="ratio-preview" style={{ aspectRatio: ratio.replace(':', '/') }} />
            <strong>{ratio}</strong>
            <small>{title}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
