"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Wand2, Clapperboard, Check, Sparkles, Clock, Sliders, Users, FileVideo, Zap } from "lucide-react"
import type { EditorMode } from "@/components/dashboard"
import { useT } from '@/lib/use-t'

interface StudioModeSelectorProps {
  editorMode: EditorMode
  onEditorModeChange: (mode: EditorMode) => void
  onStartProject: () => void
  onOpenEditor?: () => void
}

export function StudioModeSelector({ editorMode, onEditorModeChange, onStartProject, onOpenEditor }: StudioModeSelectorProps) {
  const t = useT()
  return (
    <div className="space-y-8">
      {/* Header */}
      <Card className="backdrop-blur-md bg-card/50 border-border/50">
        <CardContent className="py-6 px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clapperboard className="h-10 w-10 text-primary" />
              <div>
                <h1 className="text-3xl font-bold text-foreground">{t('DubMaster Studio')}</h1>
                <p className="text-sm text-muted-foreground">{t('Choose your editing experience')}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30">
                <Clock className="h-5 w-5 text-primary" />
                <span 
                  className="text-2xl font-bold"
                  style={{ 
                    background: "linear-gradient(180deg, #fce38a 0%, #d4a843 25%, #f9e77f 45%, #c5952a 60%, #f0d060 75%, #a67c2e 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
                  }}
                >
                  2HRS
                </span>
                <span className="text-xs text-muted-foreground">{t('Max Length')}</span>
              </div>
              <Badge variant="outline" className="text-primary border-primary">
                {editorMode === "automatic" ? t('Automatic Mode') : t('Professional Mode')}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mode Selection Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Automatic Mode Card */}
        <Card 
          className={`backdrop-blur-md bg-card/50 border-2 transition-all cursor-pointer hover:border-primary/50 ${
            editorMode === "automatic" ? "border-primary ring-2 ring-primary/20" : "border-border/50"
          }`}
          onClick={() => onEditorModeChange("automatic")}
        >
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="p-3 rounded-xl bg-primary/10">
                <Wand2 className="h-8 w-8 text-primary" />
              </div>
              {editorMode === "automatic" && (
                <div className="p-1 rounded-full bg-primary">
                  <Check className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
            </div>
            <CardTitle className="text-2xl mt-4">{t('Automatic')}</CardTitle>
            <CardDescription className="text-base">
              {t('Perfect for beginners and quick projects. Let AI handle the heavy lifting.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{t('One-click AI dubbing')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Clock className="h-4 w-4 text-primary" />
                <span>{t('Fast processing - results in minutes')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <FileVideo className="h-4 w-4 text-primary" />
                <span>{t('Automatic voice detection & assignment')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Zap className="h-4 w-4 text-primary" />
                <span>{t('Simple language selection')}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-3">{t('Best for:')}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs">{t('Social Media')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Quick Clips')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Personal Projects')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Movies')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Kung-Fu Films')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Indie Films')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Foreign Films')}</Badge>
              </div>
            </div>

            <Button 
              className="w-full mt-4" 
              variant={editorMode === "automatic" ? "default" : "outline"}
              onClick={(e) => {
                e.stopPropagation()
                onEditorModeChange("automatic")
              }}
            >
              {editorMode === "automatic" ? t('Currently Selected') : t('Select Automatic')}
            </Button>
          </CardContent>
        </Card>

        {/* Professional Mode Card */}
        <Card 
          className={`backdrop-blur-md bg-card/50 border-2 transition-all cursor-pointer hover:border-primary/50 ${
            editorMode === "professional" ? "border-primary ring-2 ring-primary/20" : "border-border/50"
          }`}
          onClick={() => onEditorModeChange("professional")}
        >
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="p-3 rounded-xl bg-primary/10">
                <Clapperboard className="h-8 w-8 text-primary" />
              </div>
              {editorMode === "professional" && (
                <div className="p-1 rounded-full bg-primary">
                  <Check className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
            </div>
            <CardTitle className="text-2xl mt-4">{t('Professional')}</CardTitle>
            <CardDescription className="text-base">
              {t('Full creative control with advanced editing tools for serious creators.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Sliders className="h-4 w-4 text-primary" />
                <span>{t('Timeline-based editing')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Users className="h-4 w-4 text-primary" />
                <span>{t('Per-speaker voice customization')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <FileVideo className="h-4 w-4 text-primary" />
                <span>{t('Transcript editing & sync')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{t('Emotion, pronunciation & pause control')}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-3">{t('Best for:')}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs">{t('Films & Documentaries')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Professional Content')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Precise Editing')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Movies')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Kung-Fu Films')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Indie Films')}</Badge>
                <Badge variant="secondary" className="text-xs">{t('Foreign Films')}</Badge>
              </div>
            </div>

            <Button 
              className="w-full mt-4" 
              variant={editorMode === "professional" ? "default" : "outline"}
              onClick={(e) => {
                e.stopPropagation()
                onEditorModeChange("professional")
              }}
            >
              {editorMode === "professional" ? t('Currently Selected') : t('Select Professional')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Start Project CTA */}
      <Card className="backdrop-blur-md bg-card/50 border-border/50">
        <CardContent className="py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-xl font-semibold mb-2">{t('Ready to start dubbing?')}</h3>
              <p className="text-muted-foreground">
                Upload a video or try the {editorMode === "automatic" ? "Automatic" : "Professional"} editor with a demo
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Button size="lg" variant="outline" onClick={onStartProject}>
                {t('Upload Video')}
              </Button>
              <Button
                size="lg"
                onClick={onOpenEditor}
                style={{
                  background: "linear-gradient(180deg, #fce38a 0%, #d4a843 30%, #c5952a 70%, #a67c2e 100%)",
                  color: "#000",
                  fontWeight: 600,
                }}
              >
                Open {editorMode === "automatic" ? "Automatic" : "Professional"} Editor
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
