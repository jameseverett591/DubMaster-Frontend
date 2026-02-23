"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Bell, Settings, User, Menu, X, Globe2, Mic2, Check } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface HeaderProps {
  activeTab?: string
  onNavigate?: (tab: string) => void
}

export function Header({ activeTab = "upload", onNavigate }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false)
  const [pricingOpen, setPricingOpen] = useState(false)

  const handleNavClick = (tab: string) => {
    if (onNavigate) {
      onNavigate(tab)
    }
    setMobileMenuOpen(false)
  }

  const voiceLibrary = [
    { name: "James", type: "Male Adult", language: "English (US)", accent: "American" },
    { name: "Sophia", type: "Female Adult", language: "English (UK)", accent: "British" },
    { name: "Carlos", type: "Male Adult", language: "Spanish", accent: "Castilian" },
    { name: "Maria", type: "Female Adult", language: "Spanish", accent: "Mexican" },
    { name: "Yuki", type: "Female Adult", language: "Japanese", accent: "Tokyo" },
    { name: "Hans", type: "Male Adult", language: "German", accent: "Standard" },
    { name: "Pierre", type: "Male Adult", language: "French", accent: "Parisian" },
    { name: "Mei", type: "Female Adult", language: "Chinese", accent: "Mandarin" },
    { name: "Timmy", type: "Male Child", language: "English (US)", accent: "American" },
    { name: "Emma", type: "Female Child", language: "English (UK)", accent: "British" },
    { name: "Raj", type: "Male Adult", language: "Hindi", accent: "Standard" },
    { name: "Fatima", type: "Female Adult", language: "Arabic", accent: "Modern Standard" },
  ]

  const pricingPlans = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      features: ["5 minutes of dubbing/month", "2 languages", "Standard voices", "720p export"],
      cta: "Current Plan"
    },
    {
      name: "Creator",
      price: "$19",
      period: "per month",
      features: ["60 minutes of dubbing/month", "12 languages", "Premium voices", "1080p export", "Priority processing"],
      cta: "Upgrade",
      popular: true
    },
    {
      name: "Professional",
      price: "$49",
      period: "per month",
      features: ["300 minutes of dubbing/month", "All languages", "All voices + cloning", "4K export", "API access", "Team collaboration"],
      cta: "Upgrade"
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "contact us",
      features: ["Unlimited dubbing", "Custom voice training", "Dedicated support", "SLA guarantee", "On-premise option"],
      cta: "Contact Sales"
    }
  ]

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/50 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => handleNavClick("upload")}>
            <Globe2 className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold text-foreground">DubVerse</span>
          </div>

          <nav className="hidden items-center gap-6 md:flex">
            <button 
              onClick={() => handleNavClick("upload")}
              className={`text-sm font-medium transition-colors hover:text-foreground ${activeTab === "upload" ? "text-foreground" : "text-muted-foreground"}`}
            >
              Dashboard
            </button>
            <button 
              onClick={() => handleNavClick("projects")}
              className={`text-sm font-medium transition-colors hover:text-foreground ${activeTab === "projects" ? "text-foreground" : "text-muted-foreground"}`}
            >
              My Projects
            </button>
            <button 
              onClick={() => setVoiceLibraryOpen(true)}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Voice Library
            </button>
            <button 
              onClick={() => setPricingOpen(true)}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="hidden md:flex">
              <Bell className="h-5 w-5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="hidden md:flex">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-border/50 bg-background/50 backdrop-blur-md p-4 md:hidden">
            <nav className="flex flex-col gap-4">
              <button 
                onClick={() => handleNavClick("upload")}
                className={`text-sm font-medium text-left ${activeTab === "upload" ? "text-foreground" : "text-muted-foreground"}`}
              >
                Dashboard
              </button>
              <button 
                onClick={() => handleNavClick("projects")}
                className={`text-sm font-medium text-left ${activeTab === "projects" ? "text-foreground" : "text-muted-foreground"}`}
              >
                My Projects
              </button>
              <button 
                onClick={() => { setVoiceLibraryOpen(true); setMobileMenuOpen(false); }}
                className="text-sm font-medium text-muted-foreground text-left"
              >
                Voice Library
              </button>
              <button 
                onClick={() => { setPricingOpen(true); setMobileMenuOpen(false); }}
                className="text-sm font-medium text-muted-foreground text-left"
              >
                Pricing
              </button>
            </nav>
          </div>
        )}
      </header>

      {/* Voice Library Modal */}
      <Dialog open={voiceLibraryOpen} onOpenChange={setVoiceLibraryOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-background/95 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic2 className="h-5 w-5 text-primary" />
              Voice Library
            </DialogTitle>
            <DialogDescription>
              Browse our collection of AI voices for dubbing. All voices support multiple emotions and speaking styles.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
            {voiceLibrary.map((voice) => (
              <Card key={voice.name} className="bg-card/50 border-border/50 hover:border-primary/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{voice.name}</CardTitle>
                  <CardDescription>{voice.type}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    <p>{voice.language}</p>
                    <p className="text-xs">{voice.accent} accent</p>
                  </div>
                  <Button variant="outline" size="sm" className="mt-3 w-full bg-transparent">
                    Preview Voice
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Pricing Modal */}
      <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-background/95 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle>Choose Your Plan</DialogTitle>
            <DialogDescription>
              Scale your dubbing projects with flexible pricing options.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-4">
            {pricingPlans.map((plan) => (
              <Card 
                key={plan.name} 
                className={`bg-card/50 border-border/50 relative ${plan.popular ? "border-primary ring-1 ring-primary" : ""}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full">
                    Most Popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground text-sm ml-1">/{plan.period}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-4">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button 
                    className="w-full" 
                    variant={plan.popular ? "default" : "outline"}
                  >
                    {plan.cta}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
