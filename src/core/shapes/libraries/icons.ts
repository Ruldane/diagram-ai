import { iconBadge, iconCard, iconShape, iconTile } from "../icon-shapes";
import type { ShapeLibrary } from "../kit";

/**
 * The four generic icon layouts. Set `data.icon` to any icon name to change
 * the pictogram (see `ICON_NAMES`).
 */
export const iconsLibrary: ShapeLibrary = {
  id: "icons",
  name: "Icons",
  description:
    "Generic icon nodes. Set data.icon to any of the 300+ available icon names (e.g. server, database, bot, shield-check).",
  shapes: [
    iconTile({
      id: "icons/tile",
      name: "Icon tile",
      icon: "box",
      aliases: ["icon-tile"],
      description: "Card with an icon above its label. Good default for architecture nodes.",
      text: "Component",
    }),
    iconCard({
      id: "icons/card",
      name: "Icon card",
      icon: "box",
      aliases: ["icon-card"],
      description: "Horizontal card: icon, bold title (first line) and subtitle (following lines).",
      text: "Title\nSubtitle",
    }),
    iconShape({
      id: "icons/icon",
      name: "Icon",
      icon: "star",
      aliases: ["pictogram", "symbol"],
      description: "Bare icon with the label underneath.",
      text: "Icon",
    }),
    iconBadge({
      id: "icons/badge",
      name: "Icon badge",
      icon: "zap",
      aliases: ["icon-badge", "icon-circle"],
      description: "Icon inside a circle with the label underneath.",
      text: "Badge",
    }),
  ],
};
