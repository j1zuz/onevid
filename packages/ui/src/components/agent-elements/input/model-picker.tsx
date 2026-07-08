"use client";

import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { memo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";
import type { ModelOption } from "../types";
import { cn } from "../utils/cn";

export type ModelPickerProps = {
  models: ModelOption[];
  value?: string;
  onChange?: (modelId: string) => void;
  placeholder?: string;
  className?: string;
};

/** Selector de modelo para el input bar (basado en agent-elements). */
export const ModelPicker = memo(function ModelPicker({
  models,
  value,
  onChange,
  placeholder = "Modelo",
  className,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const activeModel = models.find((m) => m.id === value) ?? models[0];

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label="Seleccionar modelo"
        className={cn(
          "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground",
          className
        )}
        type="button"
      >
        <span className="font-medium">{activeModel?.name ?? placeholder}</span>
        {activeModel?.version && (
          <span className="text-muted-foreground/60">{activeModel.version}</span>
        )}
        <IconChevronDown className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-44 flex-col gap-0.5 p-1"
        side="top"
        sideOffset={6}
      >
        {models.map((model) => {
          const isActive = model.id === activeModel?.id;
          return (
            <button
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                isActive && "bg-accent"
              )}
              key={model.id}
              onClick={() => {
                onChange?.(model.id);
                setOpen(false);
              }}
              type="button"
            >
              <span className="flex-1 truncate">
                {model.name}
                {model.version && (
                  <span className="ml-1 text-muted-foreground/60">
                    {model.version}
                  </span>
                )}
              </span>
              {isActive && <IconCheck className="size-3.5 shrink-0 opacity-70" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
});
