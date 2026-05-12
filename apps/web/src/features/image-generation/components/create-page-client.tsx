"use client";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Brush,
  Coins,
  Download,
  Eraser,
  ImagePlus,
  Loader2,
  Save,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { generateImageAction } from "../actions";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  IMAGE_DIMENSION_STEP,
  IMAGE_RESOLUTION_PRESETS,
  normalizeImageSize,
  parseImageSize,
  validateImageSize,
} from "../resolution";

type RecentGeneration = {
  id: string;
  prompt: string;
  imageUrl: string | null;
  createdAt: string;
};

type ResultState = {
  generationId: string;
  imageUrl: string;
  prompt: string;
  model: string;
  size: string;
  revisedPrompt?: string;
};

type EditImageFile = {
  file: File;
  previewUrl: string;
};

type MaskPoint = {
  x: number;
  y: number;
  size: number;
};

type ImageQuality = "auto" | "low" | "medium" | "high";

const defaultDimensions = parseImageSize(DEFAULT_IMAGE_SIZE) || {
  width: 1024,
  height: 1024,
};

const MAX_EDIT_IMAGES = 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

const QUALITY_OPTIONS: Array<{ value: ImageQuality; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

interface CreatePageClientProps {
  balance: number;
  creditsPerImage: number;
  recentGenerations: RecentGeneration[];
}

function isImageFile(file: File) {
  return ["image/png", "image/jpeg", "image/webp"].includes(file.type);
}

function revokePreview(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function CreatePageClient({
  balance: initialBalance,
  creditsPerImage,
  recentGenerations: initialRecent,
}: CreatePageClientProps) {
  const [prompt, setPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [width, setWidth] = useState(defaultDimensions.width);
  const [height, setHeight] = useState(defaultDimensions.height);
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [editImages, setEditImages] = useState<EditImageFile[]>([]);
  const [maskFile, setMaskFile] = useState<EditImageFile | null>(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [maskPoints, setMaskPoints] = useState<MaskPoint[]>([]);
  const [maskBrushSize, setMaskBrushSize] = useState(32);
  const [firstImageSize, setFirstImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [balance, setBalance] = useState(initialBalance);
  const [result, setResult] = useState<ResultState | null>(null);
  const [recent, setRecent] = useState<RecentGeneration[]>(initialRecent);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const maskInputRef = useRef<HTMLInputElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastMaskPointRef = useRef<{ x: number; y: number } | null>(null);

  const size = useMemo(
    () => normalizeImageSize(width, height),
    [width, height]
  );
  const sizeCheck = useMemo(() => validateImageSize(size), [size]);
  const busy = isEditing;
  const firstPreviewUrl = editImages[0]?.previewUrl || null;

  useEffect(() => {
    if (!firstPreviewUrl) {
      setFirstImageSize(null);
      setMaskEditorOpen(false);
      setMaskPoints([]);
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return null;
      });
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      setFirstImageSize({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
      setMaskPoints([]);
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return null;
      });
    };
    img.onerror = () => {
      setFirstImageSize(null);
      setMaskEditorOpen(false);
    };
    img.src = firstPreviewUrl;
  }, [firstPreviewUrl]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !firstImageSize) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(220, 38, 38, 0.46)";
    for (const point of maskPoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [maskPoints, firstImageSize]);

  const addSuccessfulResult = (
    data: {
      generationId?: string;
      imageUrl?: string;
      model?: string;
      size?: string;
      revisedPrompt?: string;
      creditsConsumed?: number;
    },
    resultPrompt: string
  ) => {
    if (!data.imageUrl || !data.generationId) return;

    const generationId = data.generationId;
    const imageUrl = data.imageUrl;
    const nextResult: ResultState = {
      generationId,
      imageUrl,
      prompt: resultPrompt,
      model: data.model || DEFAULT_IMAGE_MODEL,
      size: data.size || size,
    };
    if (data.revisedPrompt) nextResult.revisedPrompt = data.revisedPrompt;

    setResult(nextResult);
    setBalance((b) => Math.max(0, b - (data.creditsConsumed || 0)));
    setRecent((prev) => [
      {
        id: generationId,
        prompt: resultPrompt,
        imageUrl,
        createdAt: new Date().toISOString(),
      },
      ...prev.slice(0, 5),
    ]);
  };

  const showGenerationError = (message: string) => {
    if (message.toLowerCase().includes("insufficient credits")) {
      toast.error("Insufficient credits", {
        description: "You don't have enough credits to generate an image.",
        action: {
          label: "Top up",
          onClick: () => {
            window.location.href = "/dashboard/credits/buy";
          },
        },
      });
      return;
    }

    toast.error("Generation failed", { description: message });
  };

  const { execute, isExecuting } = useAction(generateImageAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.error) {
        showGenerationError(data.error);
        return;
      }

      addSuccessfulResult(data, prompt);
      toast.success("Image generated");
    },
    onError: ({ error }) => {
      toast.error("Generation failed", {
        description: error.serverError || "An unexpected error occurred.",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (balance < creditsPerImage) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!sizeCheck.valid) {
      toast.error("Invalid resolution", { description: sizeCheck.message });
      return;
    }
    setResult(null);
    execute({ prompt: prompt.trim(), size });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPrompt.trim()) {
      toast.error("Please enter an edit prompt");
      return;
    }
    if (editImages.length === 0) {
      toast.error("Upload at least one source image");
      return;
    }
    if (maskPoints.length > 0 && !maskFile) {
      toast.error("Save the mask before editing");
      return;
    }
    if (balance < creditsPerImage) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!sizeCheck.valid) {
      toast.error("Invalid resolution", { description: sizeCheck.message });
      return;
    }

    const formData = new FormData();
    formData.append("prompt", editPrompt.trim());
    formData.append("size", size);
    formData.append("quality", quality);
    editImages.forEach(({ file }) => {
      formData.append(editImages.length === 1 ? "image" : "image[]", file);
    });
    if (maskFile) formData.append("mask", maskFile.file);

    setIsEditing(true);
    setResult(null);
    try {
      const response = await fetch("/api/images/edit", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as {
        error?: string;
        generationId?: string;
        imageUrl?: string;
        model?: string;
        size?: string;
        revisedPrompt?: string;
        creditsConsumed?: number;
      };

      if (!response.ok || data.error) {
        showGenerationError(data.error || `API error: ${response.status}`);
        return;
      }

      addSuccessfulResult(data, editPrompt);
      toast.success("Image edited");
    } catch (error) {
      toast.error("Generation failed", {
        description:
          error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setIsEditing(false);
    }
  };

  const applyPreset = (presetValue: string) => {
    const preset = IMAGE_RESOLUTION_PRESETS.find(
      (item) => item.value === presetValue
    );
    if (!preset) return;
    const dimensions = parseImageSize(preset.value);
    if (!dimensions) return;
    setWidth(dimensions.width);
    setHeight(dimensions.height);
  };

  const addImages = (files: FileList | null) => {
    if (!files?.length) return;

    const accepted: EditImageFile[] = [];
    for (const file of Array.from(files)) {
      if (!isImageFile(file)) {
        toast.error("Unsupported file type", {
          description: "Use PNG, JPEG, or WebP images.",
        });
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error("File too large", {
          description: `${file.name} exceeds 25MB.`,
        });
        continue;
      }
      accepted.push({ file, previewUrl: URL.createObjectURL(file) });
    }

    if (!accepted.length) return;
    setEditImages((prev) => {
      const slots = MAX_EDIT_IMAGES - prev.length;
      if (slots <= 0) {
        for (const item of accepted) {
          revokePreview(item.previewUrl);
        }
        toast.error(`Upload up to ${MAX_EDIT_IMAGES} source images`);
        return prev;
      }
      const next = accepted.slice(0, slots);
      for (const item of accepted.slice(slots)) {
        revokePreview(item.previewUrl);
      }
      if (accepted.length > slots) {
        toast.error(`Only ${slots} more source image(s) can be added`);
      }
      return [...prev, ...next];
    });
  };

  const removeImage = (index: number) => {
    setEditImages((prev) => {
      const target = prev[index];
      if (target) revokePreview(target.previewUrl);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const setMask = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.type !== "image/png") {
      toast.error("Mask must be a PNG file");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Mask is too large", { description: "Maximum size is 25MB." });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      if (
        firstImageSize &&
        (img.naturalWidth !== firstImageSize.width ||
          img.naturalHeight !== firstImageSize.height)
      ) {
        URL.revokeObjectURL(previewUrl);
        toast.error("Mask dimensions must match the first source image", {
          description: `Expected ${firstImageSize.width}x${firstImageSize.height}.`,
        });
        return;
      }

      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return { file, previewUrl };
      });
      setMaskPoints([]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      toast.error("Failed to load mask image");
    };
    img.src = previewUrl;
  };

  const clearMask = () => {
    setMaskFile((prev) => {
      if (prev) revokePreview(prev.previewUrl);
      return null;
    });
  };

  const clearDrawnMask = () => {
    setMaskPoints([]);
    clearMask();
  };

  const addMaskPoint = (x: number, y: number) => {
    setMaskPoints((prev) => [...prev, { x, y, size: maskBrushSize }]);
    clearMask();
  };

  const getMaskPointerPosition = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const point =
      "touches" in event ? event.touches[0] || event.changedTouches[0] : event;
    if (!point) return null;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startMaskDrawing = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    event.preventDefault();
    const point = getMaskPointerPosition(event);
    if (!point) return;
    isDrawingRef.current = true;
    lastMaskPointRef.current = point;
    addMaskPoint(point.x, point.y);
  };

  const drawMaskLine = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current) return;
    event.preventDefault();
    const point = getMaskPointerPosition(event);
    const lastPoint = lastMaskPointRef.current;
    if (!point || !lastPoint) return;

    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    const angle = Math.atan2(point.y - lastPoint.y, point.x - lastPoint.x);
    const step = Math.max(1, maskBrushSize / 4);
    const nextPoints: MaskPoint[] = [];

    for (let i = step; i < distance; i += step) {
      nextPoints.push({
        x: lastPoint.x + Math.cos(angle) * i,
        y: lastPoint.y + Math.sin(angle) * i,
        size: maskBrushSize,
      });
    }
    nextPoints.push({ x: point.x, y: point.y, size: maskBrushSize });
    setMaskPoints((prev) => [...prev, ...nextPoints]);
    clearMask();
    lastMaskPointRef.current = point;
  };

  const stopMaskDrawing = () => {
    isDrawingRef.current = false;
    lastMaskPointRef.current = null;
  };

  const saveDrawnMask = () => {
    if (!firstImageSize || maskPoints.length === 0) {
      toast.error("Draw a mask area first");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = firstImageSize.width;
    canvas.height = firstImageSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    for (const point of maskPoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      ctx.fill();
    }

    const previewUrl = canvas.toDataURL("image/png");
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error("Failed to save mask");
        return;
      }
      const file = new File([blob], "generated-mask.png", {
        type: "image/png",
      });
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return { file, previewUrl };
      });
      toast.success("Mask saved");
    }, "image/png");
  };

  const resolutionControls = (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div>
            <span className="text-sm font-medium text-foreground">
              Resolution
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              Width and height must be multiples of 16.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {IMAGE_RESOLUTION_PRESETS.map((preset) => {
              const active = preset.value === size;
              return (
                <Button
                  key={preset.value}
                  type="button"
                  variant={active ? "default" : "outline"}
                  disabled={isExecuting || busy}
                  onClick={() => applyPreset(preset.value)}
                  className="h-auto min-h-14 flex-col items-start justify-center gap-0.5 px-3 py-2 text-left"
                >
                  <span className="text-sm font-medium leading-tight">
                    {preset.label}
                  </span>
                  <span className="text-[11px] leading-tight opacity-80">
                    {preset.detail}
                  </span>
                </Button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <label
                htmlFor="image-width"
                className="text-xs font-medium text-muted-foreground"
              >
                Width
              </label>
              <Input
                id="image-width"
                type="number"
                min={256}
                max={4096}
                step={IMAGE_DIMENSION_STEP}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value) || 0)}
                disabled={isExecuting || busy}
                className="w-32"
              />
            </div>
            <div className="pb-2 text-muted-foreground">x</div>
            <div className="space-y-1.5">
              <label
                htmlFor="image-height"
                className="text-xs font-medium text-muted-foreground"
              >
                Height
              </label>
              <Input
                id="image-height"
                type="number"
                min={256}
                max={4096}
                step={IMAGE_DIMENSION_STEP}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value) || 0)}
                disabled={isExecuting || busy}
                className="w-32"
              />
            </div>
            <div className="text-xs text-muted-foreground sm:pb-2">
              {size}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground lg:justify-end">
          <Coins className="h-3.5 w-3.5" />
          <span>
            Balance:{" "}
            <span className="font-medium text-foreground">{balance}</span> ·
            Cost:{" "}
            <span className="font-medium text-foreground">
              {creditsPerImage}
            </span>
            /image
          </span>
        </div>
      </div>
      {!sizeCheck.valid && (
        <p className="text-xs text-destructive">{sizeCheck.message}</p>
      )}
    </div>
  );

  const loading = isExecuting || isEditing;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 space-y-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">
          Create
        </h1>
        <p className="text-sm text-muted-foreground">
          Generate a new image from text, or transform uploaded images with a
          prompt.
        </p>
      </header>

      <Tabs defaultValue="text" className="mb-10">
        <TabsList className="mb-4 border border-border bg-muted/40">
          <TabsTrigger value="text">
            <Wand2 className="h-4 w-4" />
            Text to image
          </TabsTrigger>
          <TabsTrigger value="image">
            <ImagePlus className="h-4 w-4" />
            Image to image
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="mt-0">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to create..."
              rows={5}
              disabled={isExecuting}
              className="resize-none border-input bg-background text-base"
            />
            {resolutionControls}
            <div className="flex justify-end">
              <Button type="submit" disabled={isExecuting || !prompt.trim()}>
                {isExecuting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="image" className="mt-0">
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <Textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="Describe how to transform the uploaded image..."
              rows={5}
              disabled={isEditing}
              className="resize-none border-input bg-background text-base"
            />

            <div className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-sm font-medium text-foreground">
                    Source images
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upload PNG, JPEG, or WebP. Up to {MAX_EDIT_IMAGES} images.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isEditing || editImages.length >= MAX_EDIT_IMAGES}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload images
                </Button>
                <input
                  ref={imageInputRef}
                  type="file"
                  multiple
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    addImages(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {editImages.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                  {editImages.map((item, index) => (
                    <div
                      key={`${item.file.name}-${item.previewUrl}`}
                      className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                    >
                      <Image
                        src={item.previewUrl}
                        alt={item.file.name || `Source image ${index + 1}`}
                        fill
                        sizes="160px"
                        className="object-cover"
                        unoptimized
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-xs"
                        className="absolute right-1 top-1 opacity-95"
                        onClick={() => removeImage(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
              <div className="space-y-4 rounded-lg border border-border bg-background p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      Optional mask
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Draw on the first source image or upload a PNG mask.
                      Transparent areas are edited.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setMaskEditorOpen((value) => !value)}
                      disabled={isEditing || !firstImageSize}
                    >
                      <Brush className="mr-2 h-4 w-4" />
                      {maskEditorOpen ? "Close editor" : "Draw mask"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => maskInputRef.current?.click()}
                      disabled={isEditing || !firstImageSize}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Upload mask
                    </Button>
                    {maskFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={clearMask}
                        disabled={isEditing}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <input
                    ref={maskInputRef}
                    type="file"
                    accept="image/png"
                    className="sr-only"
                    onChange={(e) => {
                      setMask(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                {maskEditorOpen && firstPreviewUrl && firstImageSize && (
                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    <div
                      className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-md border bg-muted"
                      style={{
                        aspectRatio: `${firstImageSize.width} / ${firstImageSize.height}`,
                      }}
                    >
                      <Image
                        src={firstPreviewUrl}
                        alt="Source image for mask editing"
                        fill
                        sizes="(max-width: 1024px) 100vw, 640px"
                        className="object-contain"
                        unoptimized
                      />
                      <canvas
                        ref={maskCanvasRef}
                        width={firstImageSize.width}
                        height={firstImageSize.height}
                        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                        onMouseDown={startMaskDrawing}
                        onMouseMove={drawMaskLine}
                        onMouseUp={stopMaskDrawing}
                        onMouseLeave={stopMaskDrawing}
                        onTouchStart={startMaskDrawing}
                        onTouchMove={drawMaskLine}
                        onTouchEnd={stopMaskDrawing}
                      />
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label
                        htmlFor="mask-brush-size"
                        className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
                      >
                        Brush {maskBrushSize}px
                        <input
                          id="mask-brush-size"
                          type="range"
                          min={4}
                          max={128}
                          step={1}
                          value={maskBrushSize}
                          onChange={(event) =>
                            setMaskBrushSize(Number(event.target.value))
                          }
                          className="w-40 accent-primary"
                        />
                      </label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={clearDrawnMask}
                          disabled={isEditing}
                        >
                          <Eraser className="mr-2 h-4 w-4" />
                          Clear mask
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={saveDrawnMask}
                          disabled={isEditing || maskPoints.length === 0}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          Save mask
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {maskFile && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Saved mask
                    </p>
                    <div className="relative aspect-video w-44 overflow-hidden rounded-md border bg-muted">
                      <Image
                        src={maskFile.previewUrl}
                        alt="Mask preview"
                        fill
                        sizes="176px"
                        className="object-contain"
                        unoptimized
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-background p-4">
                <label
                  htmlFor="edit-quality"
                  className="text-sm font-medium text-foreground"
                >
                  Quality
                </label>
                <Select
                  value={quality}
                  onValueChange={(value) => setQuality(value as ImageQuality)}
                  disabled={isEditing}
                >
                  <SelectTrigger id="edit-quality" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUALITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {resolutionControls}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  isEditing || !editPrompt.trim() || editImages.length === 0
                }
              >
                {isEditing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Editing
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Edit image
                  </>
                )}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {loading && (
        <div
          className="mb-10 flex max-w-2xl items-center justify-center rounded-lg border border-dashed bg-muted/30"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Generating your image...</p>
          </div>
        </div>
      )}

      {result && !loading && (
        <section className="mb-10 space-y-4">
          <div
            className="relative mx-auto max-w-2xl overflow-hidden rounded-lg border bg-muted"
            style={{
              aspectRatio: `${parseImageSize(result.size)?.width || width} / ${parseImageSize(result.size)?.height || height}`,
            }}
          >
            <Image
              src={result.imageUrl}
              alt={result.prompt}
              fill
              sizes="(max-width: 1024px) 100vw, 768px"
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="mx-auto max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">{result.prompt}</p>
            <p className="text-xs text-muted-foreground">
              Model:{" "}
              <span className="font-medium text-foreground">
                {result.model}
              </span>{" "}
              · Resolution:{" "}
              <span className="font-medium text-foreground">{result.size}</span>
            </p>
            {result.revisedPrompt && result.revisedPrompt !== result.prompt && (
              <p className="text-xs italic text-muted-foreground">
                Revised: {result.revisedPrompt}
              </p>
            )}
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={result.imageUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </a>
              </Button>
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">Recent</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {recent.map((g) => (
              <Link
                key={g.id}
                href={`/dashboard/gallery/${g.id}`}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                title={g.prompt}
              >
                {g.imageUrl ? (
                  <Image
                    src={g.imageUrl}
                    alt={g.prompt}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImagePlus className="h-6 w-6" />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
