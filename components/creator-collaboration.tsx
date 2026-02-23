"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Users, MessageSquare, Share2, UserPlus, Globe, Lock, Clock, Send, Plus } from "lucide-react"

type Project = {
  id: string
  title: string
  owner: string
  ownerAvatar: string
  status: "active" | "completed" | "review"
  collaborators: number
  targetLanguage: string
  progress: number
  lastActivity: string
}

type Message = {
  id: string
  user: string
  avatar: string
  message: string
  timestamp: string
}

const SAMPLE_PROJECTS: Project[] = [
  {
    id: "1",
    title: "Product Demo - Spanish Version",
    owner: "Sarah Chen",
    ownerAvatar: "/professional-woman-avatar.png",
    status: "active",
    collaborators: 4,
    targetLanguage: "Spanish",
    progress: 65,
    lastActivity: "2 hours ago",
  },
  {
    id: "2",
    title: "Tutorial Series - French Dub",
    owner: "Marcus Johnson",
    ownerAvatar: "/professional-man-avatar.png",
    status: "review",
    collaborators: 3,
    targetLanguage: "French",
    progress: 90,
    lastActivity: "30 minutes ago",
  },
  {
    id: "3",
    title: "Documentary - German Version",
    owner: "Emma Wilson",
    ownerAvatar: "/creative-woman-avatar.png",
    status: "completed",
    collaborators: 5,
    targetLanguage: "German",
    progress: 100,
    lastActivity: "1 day ago",
  },
]

const SAMPLE_MESSAGES: Message[] = [
  {
    id: "1",
    user: "Sarah Chen",
    avatar: "/professional-woman-avatar.png",
    message: "I've finished the first segment. Can someone review the timing?",
    timestamp: "2:30 PM",
  },
  {
    id: "2",
    user: "Marcus Johnson",
    avatar: "/professional-man-avatar.png",
    message: "Looks great! I'll adjust the male voice pitch slightly for the narrator.",
    timestamp: "2:45 PM",
  },
  {
    id: "3",
    user: "Emma Wilson",
    avatar: "/creative-woman-avatar.png",
    message: "The child voice in segment 3 needs a bit more energy. I'll work on it.",
    timestamp: "3:15 PM",
  },
]

export function CreatorCollaboration() {
  const [activeTab, setActiveTab] = useState("projects")
  const [newMessage, setNewMessage] = useState("")
  const [messages, setMessages] = useState(SAMPLE_MESSAGES)

  const handleSendMessage = () => {
    if (!newMessage.trim()) return
    setMessages([
      ...messages,
      {
        id: Date.now().toString(),
        user: "You",
        avatar: "/diverse-user-avatars.png",
        message: newMessage,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ])
    setNewMessage("")
  }

  const getStatusBadge = (status: Project["status"]) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500/10 text-green-500">Active</Badge>
      case "review":
        return <Badge className="bg-amber-500/10 text-amber-500">In Review</Badge>
      case "completed":
        return <Badge className="bg-blue-500/10 text-blue-500">Completed</Badge>
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Creator Collaboration</h2>
          <p className="mt-1 text-muted-foreground">Work together with other creators on dubbing projects</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-background/50 backdrop-blur-md">
          <TabsTrigger value="projects" className="gap-2">
            <Share2 className="h-4 w-4" />
            Projects
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-2">
            <Users className="h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Chat
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {SAMPLE_PROJECTS.map((project) => (
              <Card key={project.id} className="transition-all hover:border-primary/50 backdrop-blur-md bg-card/50 border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={project.ownerAvatar || "/placeholder.svg"} />
                        <AvatarFallback>{project.owner[0]}</AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-base">{project.title}</CardTitle>
                        <CardDescription>{project.owner}</CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(project.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Globe className="h-4 w-4" />
                        {project.targetLanguage}
                      </span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-4 w-4" />
                        {project.collaborators} collaborators
                      </span>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium text-foreground">{project.progress}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {project.lastActivity}
                      </span>
                      <Button variant="outline" size="sm">
                        Open Project
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="backdrop-blur-md bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>People you collaborate with frequently</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { name: "Sarah Chen", role: "Voice Director", projects: 12 },
                    { name: "Marcus Johnson", role: "Translator", projects: 8 },
                    { name: "Emma Wilson", role: "Voice Actor", projects: 15 },
                    { name: "David Park", role: "Audio Engineer", projects: 6 },
                  ].map((member, index) => (
                    <div key={index} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage
                            src={`/.jpg?height=40&width=40&query=${member.name} avatar`}
                          />
                          <AvatarFallback>{member.name[0]}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">{member.name}</p>
                          <p className="text-sm text-muted-foreground">{member.role}</p>
                        </div>
                      </div>
                      <Badge variant="secondary">{member.projects} projects</Badge>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="mt-4 w-full gap-2 bg-transparent">
                  <UserPlus className="h-4 w-4" />
                  Invite Team Member
                </Button>
              </CardContent>
            </Card>

            <Card className="backdrop-blur-md bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle>Invite Collaborators</CardTitle>
                <CardDescription>Add people to your current project</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">Email Address</label>
                    <Input placeholder="colleague@example.com" className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">Role</label>
                    <Input placeholder="e.g., Translator, Voice Actor" className="mt-1.5" />
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <Lock className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-foreground">Private Project</p>
                      <p className="text-sm text-muted-foreground">Only invited members can access</p>
                    </div>
                  </div>
                  <Button className="w-full">Send Invitation</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="chat" className="mt-6">
          <Card className="flex h-[500px] flex-col backdrop-blur-md bg-card/50 border-border/50">
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Project Chat</CardTitle>
                  <CardDescription>Product Demo - Spanish Version</CardDescription>
                </div>
                <Badge variant="outline" className="gap-1">
                  <span className="h-2 w-2 rounded-full bg-green-500" />4 online
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={msg.avatar || "/placeholder.svg"} />
                      <AvatarFallback>{msg.user[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{msg.user}</span>
                        <span className="text-xs text-muted-foreground">{msg.timestamp}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{msg.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            <div className="border-t border-border p-4">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="min-h-[44px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                />
                <Button size="icon" onClick={handleSendMessage}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
