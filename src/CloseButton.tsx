// Shared close/dismiss control for every panel. Deliberately NOT
// position:absolute -- it must be a normal flex child of a non-scrolling
// header row (see .panel-header in App.css). That is the root-cause fix for
// the close-button hitbox bug: a `position:absolute; right:Npx` button
// anchored inside an `overflow-y:auto` ancestor gets shifted by the
// scrollbar's width once a scrollbar appears (confirmed empirically --
// Chromium computes the abs-pos containing block from the scroll
// container's clientWidth, which shrinks when a scrollbar renders), so the
// visible glyph silently drifts away from where "right:12px" was authored
// to place it. Living in the header removes the scrolling ancestor
// entirely, so there is nothing for a scrollbar to disturb.
//
// The hit area is also a fixed 28x28 box with the icon centered by flex,
// not by font baseline/line-height (which vary by browser and were the
// other source of an icon-vs-hitbox mismatch) -- so the visible X and the
// clickable region are always the same rectangle.
export default function CloseButton({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="close-btn" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
