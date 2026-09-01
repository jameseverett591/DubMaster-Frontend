'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Users, UserPlus, Send, Globe, Lock, Clock, Check,
  Film, MoreHorizontal, Mail, Trash2, Crown, Eye, Pencil,
} from 'lucide-react'
import { useT } from '@/lib/use-t'

type Role = 'owner' | 'editor' | 'reviewer' | 'viewer'
type Member = { id: string; name: string; email: string; role: Role; initials: string; color: string; online: boolean }
type SharedProject = { id: string; title: string; language: string; progress: number; owner: string; role: Role; lastEdit: string; status: 'active' | 'review' | 'completed' }

const ROLE_CONFIG: Record<Role, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  owner:    { label: 'Owner',    color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',    icon: Crown },
  editor:   { label: 'Editor',   color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',       icon: Pencil },
  reviewer: { label: 'Reviewer', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', icon: Eye },
  viewer:   { label: 'Viewer',   color: 'text-slate-400 bg-slate-500/10 border-slate-500/30',    icon: Eye },
}

const DEMO_MEMBERS: Member[] = [
  { id: '1', name: 'James Everett',  email: 'james.everett.jmpl@gmail.com', role: 'owner',    initials: 'JE', color: 'bg-amber-600',  online: true },
  { id: '2', name: 'Sarah Chen',     email: 'sarah.chen@studio.com',        role: 'editor',   initials: 'SC', color: 'bg-blue-600',   online: true },
  { id: '3', name: 'Marcus Johnson', email: 'marcus.j@dublab.io',            role: 'reviewer', initials: 'MJ', color: 'bg-purple-600', online: false },
  { id: '4', name: 'Emma Wilson',    email: 'emma@filmcraft.co',             role: 'viewer',   initials: 'EW', color: 'bg-rose-600',   online: false },
]

const DEMO_PROJECTS: SharedProject[] = [
  { id: '1', title: 'Ip Man Fight Scene',        language: 'English', progress: 78,  owner: 'James Everett', role: 'owner',    lastEdit: '2 min ago',   status: 'active' },
  { id: '2', title: 'Tutorial Series - French',  language: 'French',  progress: 92,  owner: 'Sarah Chen',    role: 'editor',   lastEdit: '1 hour ago',  status: 'review' },
  { id: '3', title: 'Marketing Video - Spanish', language: 'Spanish', progress: 100, owner: 'Marcus Johnson', role: 'reviewer', lastEdit: '2 days ago',  status: 'completed' },
]

const STATUS_COLORS = {
  active:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  review:    'text-amber-400 bg-amber-500/10 border-amber-500/30',
  completed: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
}

export default function CollaboratePage() {
  const t = useT()
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>(DEMO_MEMBERS)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('editor')
  const [inviteSent, setInviteSent] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  const handleInvite = () => {
    if (!inviteEmail.trim()) return
    setInviteSent(true)
    setInviteEmail('')
    setTimeout(() => setInviteSent(false), 3000)
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(typeof window !== 'undefined' ? window.location.origin + '/collaborate/join?team=dubmaster' : '')
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const removeMember = (id: string) => {
    setMembers(prev => prev.filter(m => m.id !== id))
  }

  const changeRole = (id: string, role: Role) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, role } : m))
  }

  return (
    <div className="min-h-screen bg-[#020817] text-white">
      <Header />

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Users className="h-6 w-6 text-purple-400" />
              {t('Collaborate')}
            </h1>
            <p className="text-slate-400 text-sm mt-1">{t('Invite your team and work on dubbing projects together.')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-slate-700 text-slate-400 hover:text-white"
            onClick={() => router.push('/dashboard')}
          >
            ← Dashboard
          </Button>
        </div>

        <Tabs defaultValue="team" className="w-full">
          <TabsList className="bg-slate-900 border border-slate-800 p-1 h-auto">
            <TabsTrigger value="team"     className="text-xs data-[state=active]:bg-slate-800 data-[state=active]:text-white">{t('Team Members')}</TabsTrigger>
            <TabsTrigger value="projects" className="text-xs data-[state=active]:bg-slate-800 data-[state=active]:text-white">{t('Shared Projects')}</TabsTrigger>
            <TabsTrigger value="invite"   className="text-xs data-[state=active]:bg-slate-800 data-[state=active]:text-white">{t('Invite')}</TabsTrigger>
          </TabsList>

          {/* ── TEAM MEMBERS ── */}
          <TabsContent value="team" className="mt-6 space-y-3">
            {members.map(member => {
              const cfg = ROLE_CONFIG[member.role]
              const RoleIcon = cfg.icon
              return (
                <div key={member.id} className="flex items-center gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors">
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className={`${member.color} text-white text-sm font-semibold`}>{member.initials}</AvatarFallback>
                    </Avatar>
                    {member.online && (
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[#020817]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate">{member.name}</p>
                      {member.online && <span className="text-[10px] text-emerald-400">● Online</span>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{member.email}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {member.role === 'owner' ? (
                      <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
                        <RoleIcon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                    ) : (
                      <select
                        title={t('Change role')}
                        value={member.role}
                        onChange={e => changeRole(member.id, e.target.value as Role)}
                        className="text-[11px] bg-slate-800 border border-slate-700 rounded-full px-2 py-0.5 text-slate-300 focus:outline-none focus:border-purple-500/50"
                      >
                        <option value="editor">{t('Editor')}</option>
                        <option value="reviewer">{t('Reviewer')}</option>
                        <option value="viewer">{t('Viewer')}</option>
                      </select>
                    )}
                    {member.role !== 'owner' && (
                      <button
                        type="button"
                        title={t('Remove member')}
                        onClick={() => removeMember(member.id)}
                        className="text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </TabsContent>

          {/* ── SHARED PROJECTS ── */}
          <TabsContent value="projects" className="mt-6 space-y-3">
            {DEMO_PROJECTS.map(project => {
              const roleConfig = ROLE_CONFIG[project.role]
              return (
                <div key={project.id} className="flex items-center gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer group"
                  onClick={() => router.push('/dashboard?tab=projects')}
                >
                  <div className="h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                    <Film className="h-5 w-5 text-slate-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white truncate group-hover:text-purple-300 transition-colors">{project.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_COLORS[project.status]}`}>
                        {project.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span><Globe className="h-3 w-3 inline mr-1" />{project.language}</span>
                      <span><Clock className="h-3 w-3 inline mr-1" />{project.lastEdit}</span>
                      <span>by {project.owner}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-slate-400 mb-1">{project.progress}%</p>
                      <div className="w-24 h-1 bg-slate-800 rounded-full overflow-hidden">
                        {/* eslint-disable-next-line react/forbid-dom-props */}
                        <div
                          className="h-full rounded-full bg-purple-500"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${roleConfig.color}`}>
                      {roleConfig.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </TabsContent>

          {/* ── INVITE ── */}
          <TabsContent value="invite" className="mt-6 space-y-6">
            {/* Email invite */}
            <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
                  <Mail className="h-4 w-4 text-purple-400" />
                  {t('Invite by Email')}
                </h3>
                <p className="text-xs text-slate-500">{t("They'll receive an email with a link to join your workspace.")}</p>
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="colleague@studio.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleInvite() }}
                  className="flex-1 bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-purple-500/50"
                />
                <select
                  title={t('Invite role')}
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as Role)}
                  className="bg-slate-800 border border-slate-700 rounded-md px-3 text-sm text-slate-300 focus:outline-none focus:border-purple-500/50"
                >
                  <option value="editor">{t('Editor')}</option>
                  <option value="reviewer">{t('Reviewer')}</option>
                  <option value="viewer">{t('Viewer')}</option>
                </select>
                <Button
                  className={inviteSent ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-purple-600 hover:bg-purple-700'}
                  onClick={handleInvite}
                  disabled={!inviteEmail.trim()}
                >
                  {inviteSent ? <><Check className="h-4 w-4 mr-1" /> {t('Sent!')}</> : <><Send className="h-4 w-4 mr-1" /> {t('Send')}</>}
                </Button>
              </div>
            </div>

            {/* Invite link */}
            <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
                  <Lock className="h-4 w-4 text-slate-400" />
                  {t('Invite Link')}
                </h3>
                <p className="text-xs text-slate-500">{t('Share this link — anyone with it can request to join your workspace.')}</p>
              </div>
              <div className="flex gap-2">
                <Input
                  readOnly
                  aria-label={t('Invite link')}
                  value="dubmaster.app/collaborate/join?team=dubmaster"
                  className="flex-1 bg-slate-800 border-slate-700 text-slate-400 text-xs"
                />
                <Button
                  variant="outline"
                  className={`border-slate-700 shrink-0 transition-colors ${copiedLink ? 'text-emerald-400 border-emerald-500/40' : 'text-slate-300'}`}
                  onClick={handleCopyLink}
                >
                  {copiedLink ? <><Check className="h-4 w-4 mr-1" /> {t('Copied')}</> : 'Copy Link'}
                </Button>
              </div>
            </div>

            {/* Role guide */}
            <div className="grid grid-cols-3 gap-3">
              {(['editor', 'reviewer', 'viewer'] as Role[]).map(role => {
                const cfg = ROLE_CONFIG[role]
                const Icon = cfg.icon
                const perms: Record<Role, string[]> = {
                  owner:    [],
                  editor:   ['Edit segments', 'Change voices', 'Generate speech', 'View QC report'],
                  reviewer: ['Comment on segments', 'View QC report', 'Approve / reject edits'],
                  viewer:   ['Watch dubbed video', 'View transcript', 'Download (if shared)'],
                }
                return (
                  <div key={role} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}>
                      <Icon className="h-3 w-3" />
                      {cfg.label}
                    </span>
                    <ul className="space-y-1">
                      {perms[role].map(p => (
                        <li key={p} className="text-[11px] text-slate-400 flex items-center gap-1.5">
                          <Check className="h-2.5 w-2.5 text-slate-600 shrink-0" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
