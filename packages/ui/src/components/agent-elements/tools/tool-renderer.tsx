import React, { memo, useState } from "react";
import {
  IconSearch as Search,
  IconGlobe as Globe,
  IconCalculator as Calculator,
  IconDownload as Download,
} from "@tabler/icons-react";
import { toolRegistry, parseMcpToolType } from "./tool-registry";
import { getToolStatus } from "../utils/format-tool";
import { GenericTool } from "./generic-tool";
import { BashTool } from "./bash-tool";
import { EditTool } from "./edit-tool";
import { TodoTool } from "./todo-tool";
import { PlanTool } from "./plan-tool";
import { ToolGroup } from "./tool-group";
import { McpTool, unwrapMcpOutput } from "./mcp-tool";
import { ThinkingTool } from "./thinking-tool";
import { SearchTool } from "./search-tool";
import { QuestionTool } from "../question/question-tool";
import { SpiralLoader } from "../spiral-loader";
import { TextShimmer } from "../text-shimmer";
import type { CustomToolRendererProps } from "../types";

export type ToolRendererProps = {
  part: any;
  nestedTools?: any[];
  chatStatus?: string;
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
};

// Tools propias del agente (Flue `defineTool`) llegan como `dynamic-tool` con
// `part.toolName`. El `output` es un string (no `{results}`), así que mostramos
// una fila simple con la entrada relevante; la respuesta del modelo ya integra
// el resultado.
const DYNAMIC_TOOL_META: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    getSubtitle: (input: Record<string, unknown>) => unknown;
  }
> = {
  web_search: {
    icon: Search,
    label: "Búsqueda web",
    getSubtitle: (input) => input.query,
  },
  fetch_url: {
    icon: Globe,
    label: "Leer página",
    getSubtitle: (input) => input.url,
  },
  calculator: {
    icon: Calculator,
    label: "Calculadora",
    getSubtitle: (input) => input.expression,
  },
};

// Tools de imagen (Flue): renderizamos la imagen DIRECTO desde el output de la tool
// (que trae la URL), no desde el texto del modelo — así no depende de que el modelo
// reproduzca bien una URL larga. Mientras genera, mostramos un skeleton.
const IMAGE_TOOLS = new Set(["generate_image", "edit_image"]);
const IMAGE_URL_RE = /https?:\/\/[^\s)"'\\]+/g;

/**
 * Saca del output de la tool la URL de VER (CDN) y la de DESCARGAR (Worker
 * `/download`, que fuerza attachment). Robusto a la forma del output.
 */
function extractImageUrls(output: unknown): {
  view: string | null;
  download: string | null;
} {
  if (output == null) {
    return { view: null, download: null };
  }
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const all = Array.from(text.matchAll(IMAGE_URL_RE), (m) => m[0]);
  const download = all.find((u) => u.includes("/download?")) ?? null;
  const view = all.find((u) => u !== download) ?? all[0] ?? null;
  return { view, download };
}

function ImageTool({ part, chatStatus }: { part: any; chatStatus?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const status = deriveToolStatus(part, chatStatus);
  const label =
    part.toolName === "edit_image" ? "Editando imagen" : "Generando imagen";

  if (status === "pending" || status === "streaming") {
    return (
      <div className="my-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-an-foreground-muted text-sm">
          <SpiralLoader size={12} />
          <TextShimmer as="span">{`${label}…`}</TextShimmer>
        </div>
        <div className="h-64 w-64 max-w-full animate-pulse rounded-an-message bg-an-foreground/5" />
      </div>
    );
  }

  const { view, download } = extractImageUrls(part.output);
  if (status === "error" || !view) {
    const text =
      typeof part.output === "string"
        ? part.output
        : "No se pudo procesar la imagen.";
    return (
      <GenericTool isError isPending={false} subtitle={text} title={label} />
    );
  }
  // Descarga real por el Worker (`/download` manda Content-Disposition attachment →
  // baja el archivo). Si no vino URL de descarga, cae a la de ver.
  const downloadUrl = download ?? view;
  // Si la imagen no carga (p. ej. hotlink), mostramos un enlace visible.
  if (imgFailed) {
    return (
      <a
        className="an-md-link my-2 inline-block text-an-primary-color text-sm underline underline-offset-2"
        href={view}
        rel="noopener noreferrer"
        target="_blank"
      >
        Ver imagen
      </a>
    );
  }
  return (
    <div className="my-2 flex flex-col items-start gap-1.5">
      {/* biome-ignore lint/performance/noImgElement: imagen generada por el asistente */}
      <img
        alt={label}
        className="max-h-96 max-w-full rounded-an-message border border-an-border-color object-contain"
        loading="lazy"
        onError={() => setImgFailed(true)}
        referrerPolicy="no-referrer"
        src={view}
      />
      {/* Descarga por el Worker (attachment) → baja el archivo, no lo abre. */}
      <a
        className="flex items-center gap-1 text-an-foreground-muted text-xs transition-colors hover:text-an-foreground"
        download
        href={downloadUrl}
      >
        <Download className="size-3.5" />
        Descargar
      </a>
    </div>
  );
}

function deriveToolStatus(
  part: any,
  chatStatus?: string,
): CustomToolRendererProps["status"] {
  if (part.state === "input-streaming") return "streaming";
  if (part.state === "output-available") return "success";
  if (part.state === "output-error") return "error";
  const { isPending } = getToolStatus(part, chatStatus);
  return isPending ? "pending" : "success";
}

export const ToolRenderer = memo(function ToolRenderer({
  part,
  nestedTools,
  chatStatus,
  toolRenderers,
}: ToolRendererProps) {
  const partType = part.type as string;

  // Tools propias del agente (Flue): `dynamic-tool` despachado por `toolName`.
  // No usamos SearchTool aquí: el output es texto (no `{results}`), así que mostraría
  // "Found 0 results". GenericTool muestra solo la consulta, limpio.
  if (partType === "dynamic-tool") {
    const toolName = (part.toolName as string) ?? "tool";
    if (IMAGE_TOOLS.has(toolName)) {
      return <ImageTool chatStatus={chatStatus} part={part} />;
    }
    const meta = DYNAMIC_TOOL_META[toolName];
    const input = (part.input ?? {}) as Record<string, unknown>;
    const subtitle = meta?.getSubtitle(input);
    const { isPending, isError } = getToolStatus(part, chatStatus);
    return (
      <GenericTool
        icon={meta?.icon}
        title={meta?.label ?? toolName}
        subtitle={typeof subtitle === "string" ? subtitle : undefined}
        isPending={isPending}
        isError={isError}
      />
    );
  }

  // Specialized tool components with variant dispatch
  switch (partType) {
    case "tool-Bash":
      return <BashTool part={part} />;
    case "tool-Edit":
    case "tool-Write":
      return <EditTool part={part} />;
    case "tool-WebSearch":
    case "tool-Grep":
    case "tool-Glob":
      return <SearchTool part={part} />;
    case "tool-PlanWrite":
      return <PlanTool part={part} chatStatus={chatStatus} />;
    case "tool-TodoWrite":
      return <TodoTool part={part} chatStatus={chatStatus} />;
    case "tool-Question":
      return <QuestionTool part={part} chatStatus={chatStatus} />;
    case "tool-Task":
    case "tool-Agent":
      const labelBase = part.type === "tool-Agent" ? "Agent" : "Task";
      return (
        <ToolGroup
          part={part}
          nestedTools={nestedTools}
          chatStatus={chatStatus}
          completeLabel={`${labelBase} completed`}
          shimmerLabel={`Running ${labelBase.toLowerCase()}`}
          interruptedLabel={`${labelBase} interrupted`}
          defaultOpen={false}
        />
      );
    case "tool-Thinking":
      return <ThinkingTool part={part} />;
  }

  // MCP tools
  const mcpInfo = parseMcpToolType(partType);
  if (mcpInfo) {
    // Custom renderer for user-defined tools
    if (toolRenderers && mcpInfo.serverName === "user-tools") {
      const CustomRenderer = toolRenderers[mcpInfo.toolName];
      if (CustomRenderer) {
        return (
          <CustomRenderer
            name={mcpInfo.toolName}
            input={(part.input ?? {}) as Record<string, unknown>}
            output={part.output ? unwrapMcpOutput(part.output) : undefined}
            status={deriveToolStatus(part, chatStatus)}
          />
        );
      }
    }
    return <McpTool part={part} mcpInfo={mcpInfo} chatStatus={chatStatus} />;
  }

  // Registry-based generic tools (Read, Grep, Glob, WebFetch, etc.)
  const meta = toolRegistry[partType];
  if (meta) {
    const { isPending, isError } = getToolStatus(part, chatStatus);
    return (
      <GenericTool
        title={meta.title(part)}
        subtitle={meta.subtitle?.(part)}
        isPending={isPending}
        isError={isError}
      />
    );
  }

  // Fallback: show tool name
  const toolName = partType.startsWith("tool-") ? partType.slice(5) : partType;
  const { isPending, isError } = getToolStatus(part, chatStatus);
  return (
    <GenericTool
      title={isPending ? `Running ${toolName}` : toolName}
      isPending={isPending}
      isError={isError}
    />
  );
});
