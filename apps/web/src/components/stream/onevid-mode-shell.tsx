"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { MonitorPlayIcon, UploadIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { LocalVideoPlayer } from "./local-video-player";

/**
 * Top-level mode switcher for the onevid screen. The "Local" tab always works
 * with no configuration (plays a device video); the "Stream" tab holds the
 * existing TMDB/TorBox setup or catalog passed as children.
 */
export function OneVidModeShell({
  children,
  defaultMode = "local",
}: {
  children: ReactNode;
  defaultMode?: "local" | "stream";
}) {
  // Controlled so the tab doesn't reset/warn when `defaultMode` changes between
  // server renders (e.g. after connecting TMDB flips it from local to stream).
  // The prop only seeds the initial value.
  const [mode, setMode] = useState<"local" | "stream">(defaultMode);

  return (
    <Tabs
      className="w-full gap-6"
      onValueChange={(value) => setMode(value as "local" | "stream")}
      value={mode}
    >
      <TabsList className="mx-auto">
        <TabsTrigger className="px-3" value="local">
          <UploadIcon />
          Reproducir video
        </TabsTrigger>
        <TabsTrigger className="px-3" value="stream">
          <MonitorPlayIcon />
          Stream
        </TabsTrigger>
      </TabsList>
      <TabsContent value="local">
        <LocalVideoPlayer />
      </TabsContent>
      <TabsContent value="stream">{children}</TabsContent>
    </Tabs>
  );
}
