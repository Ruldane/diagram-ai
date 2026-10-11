"use client";

import { Moon, Sun } from "lucide-react";

import { IconButton } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <IconButton label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}
