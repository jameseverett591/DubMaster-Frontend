# 🎬 DubVerse Developer Workflow Guide

> **Your streamlined, battle-tested development setup**

---

## 🚀 Quick Start (First Time Setup)

### 1. Clone & Navigate
```bash
cd /path/to/dubverse
```

### 2. Set Up Environment
```bash
# Copy environment template
cp .env.example .env

# Edit with your API keys
nano .env  # or use your preferred editor
```

**Required API keys:**
- `ELEVENLABS_API_KEY` - Get from https://elevenlabs.io/
- `DEEPL_API_KEY` - Get from https://www.deepl.com/pro-api
- `HUGGING_FACE_TOKEN` - Get from https://huggingface.co/settings/tokens

### 3. Start Everything
```bash
./start.sh
```

That's it! Your entire stack is running in Docker.

---

## 🛠️ Daily Development Workflow

### Starting Your Day
```bash
./start.sh
```
Opens frontend at http://localhost:3000 and backend at http://localhost:8000

### Monitoring & Debugging
```bash
./monitor.sh
```
Interactive menu for logs, health checks, debugging

### Stopping for the Day
```bash
./stop.sh
```

---

## 🧑‍💻 Your Optimal Coding Setup

### **AI Assistant Roles (Use Only These 3)**

#### 1. **GitHub Copilot** → Fast Autocomplete
**When to use:**
- Writing repetitive code (API routes, Pydantic models)
- Common patterns (error handling, type definitions)
- Boilerplate (imports, basic functions)

**Workflow:**
- Just start typing, accept suggestions with Tab
- Don't overthink it - it's for speed, not architecture

#### 2. **Claude Code (Terminal)** → Deep Work
**When to use:**
- Debugging complex issues (TTS failures, pipeline bugs)
- Architectural decisions (refactoring, new features)
- Understanding codebases (how does diarization work?)
- Multi-file changes

**Workflow:**
```bash
# From your terminal
claude "Fix the voice assignment bug where all speakers get male voice"
claude "Explain how the audio processing pipeline works"
claude "Refactor elevenlabs_tts.py to handle quota errors better"
```

#### 3. **Web Claude/ChatGPT** → Research & Learning
**When to use:**
- Learning new concepts ("How does pyannote.audio work?")
- Comparing approaches ("Edge TTS vs Coqui for multi-voice?")
- Understanding errors ("What does this PyTorch error mean?")

**Workflow:**
- Use browser for exploratory questions
- Copy code back to your IDE

### **Disable These (Redundant)**
- ❌ Augment Code
- ❌ BLACKBOXAI (both extensions)
- ❌ DeepSeek Copilot
- ❌ Verdent AI
- ❌ Codex extension
- ❌ ACE for GitHub Copilot

**Why?** They create noise, conflict with each other, and slow you down.

---

## 📁 Project Structure Reference

```
dubverse/
├── backend/
│   ├── Dockerfile                 # Backend container definition
│   ├── requirements.txt           # Python dependencies
│   ├── app/
│   │   ├── main.py               # FastAPI application
│   │   ├── pipeline/             # Audio processing
│   │   │   ├── diarize_audio.py
│   │   │   ├── transcribe_audio.py
│   │   │   └── elevenlabs_tts.py
│   │   └── routes/               # API endpoints
│   ├── data/                     # Persistent data
│   ├── uploads/                  # User uploads
│   └── outputs/                  # Generated videos
│
├── frontend/
│   ├── Dockerfile                # Frontend container definition
│   ├── package.json              # Node dependencies
│   ├── src/ or app/              # Next.js source
│   └── public/                   # Static assets
│
├── docker-compose.yml            # Orchestrates all services
├── .env                          # Your API keys (DO NOT COMMIT)
├── .env.example                  # Template for .env
├── .dockerignore                 # Files to exclude from Docker
│
├── start.sh                      # ⭐ Start everything
├── stop.sh                       # ⭐ Stop everything
├── monitor.sh                    # ⭐ Monitor & debug
│
└── README.md                     # This guide
```

---

## 🔧 Common Development Tasks

### Making Backend Changes
```bash
# Your code changes hot-reload automatically!
# Just edit files in backend/app/

# If you need to restart:
./monitor.sh → Option 7 (Restart Services)

# If you need a shell inside the container:
./monitor.sh → Option 9 (Debug Mode) → 1 (Backend)
```

### Making Frontend Changes
```bash
# Hot reload works automatically!
# Just edit files in frontend/src/ or frontend/app/

# Clear Next.js cache if things look weird:
docker-compose exec frontend rm -rf .next
docker-compose restart frontend
```

### Installing New Dependencies

**Backend (Python):**
```bash
# 1. Add to backend/requirements.txt
echo "new-package==1.0.0" >> backend/requirements.txt

# 2. Rebuild backend
docker-compose build backend
docker-compose restart backend
```

**Frontend (Node):**
```bash
# 1. Add to package.json or:
docker-compose exec frontend npm install new-package

# 2. Rebuild if needed
docker-compose build frontend
docker-compose restart frontend
```

### Testing Your Changes
```bash
# Backend API docs
http://localhost:8000/docs

# Test dubbing flow
1. Go to http://localhost:3000
2. Upload a video
3. Click "Dubbing"
4. Watch logs: docker-compose logs -f backend
```

---

## 🐛 Troubleshooting

### Problem: "Port already in use"
```bash
# Find and kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Or port 3000
lsof -ti:3000 | xargs kill -9

# Then restart
./start.sh
```

### Problem: "Backend not responding"
```bash
# Check health
curl http://localhost:8000/health

# View logs
docker-compose logs backend

# Or use monitor
./monitor.sh → Option 5 (Health Checks)
```

### Problem: "Changes not showing up"
```bash
# Hard refresh browser (Ctrl+Shift+R)
# Or clear cache
./monitor.sh → Option 8 (Clean & Rebuild)
```

### Problem: "Docker is slow"
```bash
# Clean up Docker
docker system prune -a

# Check resources
./monitor.sh → Option 10 (Resource Usage)
```

### Problem: "ElevenLabs quota exhausted"
```bash
# Check quota
./monitor.sh → Option 6 (Check ElevenLabs Quota)

# Fallback to Edge TTS automatically kicks in
# To force Edge TTS for testing, set ELEVENLABS_API_KEY="" in .env
```

---

## 📊 Monitoring Your Application

### View Live Logs
```bash
# All services
docker-compose logs -f

# Backend only
docker-compose logs -f backend

# Frontend only
docker-compose logs -f frontend

# Or use the menu
./monitor.sh → Option 2, 3, or 4
```

### Check Service Health
```bash
# Manual
curl http://localhost:8000/health
curl http://localhost:3000

# Or use monitor
./monitor.sh → Option 5
```

### Check Resource Usage
```bash
docker stats

# Or use monitor
./monitor.sh → Option 1 or 10
```

---

## 🎯 Best Practices

### ✅ DO:
- **Commit often** (small, focused commits)
- **Use the monitoring script** when debugging
- **Check logs** when something breaks
- **Test locally** before pushing
- **Keep .env out of git** (use .env.example)

### ❌ DON'T:
- **Commit .env file** (contains secrets!)
- **Mix venv and Docker** (pick one - we're using Docker)
- **Skip health checks** (run monitor.sh regularly)
- **Ignore warnings** (they usually predict failures)
- **Run multiple AI assistants simultaneously** (pick the right tool)

---

## 🔄 Git Workflow

```bash
# 1. Create feature branch
git checkout -b feature/improve-voice-assignment

# 2. Make changes, test locally
./start.sh
# ... develop ...

# 3. Commit
git add .
git commit -m "Improve voice assignment logic for multiple speakers"

# 4. Push
git push origin feature/improve-voice-assignment

# 5. Create Pull Request on GitHub
```

---

## 🎓 Learning Resources

### Understanding the Stack
- **FastAPI:** https://fastapi.tiangolo.com/
- **Next.js:** https://nextjs.org/docs
- **Docker:** https://docs.docker.com/get-started/
- **pyannote.audio:** https://github.com/pyannote/pyannote-audio

### When Stuck
1. Check logs: `./monitor.sh`
2. Ask Claude Code: `claude "explain this error"`
3. Search docs/GitHub issues
4. Ask in web chat for conceptual questions

---

## 🚢 Future: Production Deployment

When ready for production, you'll need:

1. **Environment variables** for production
2. **Database** (PostgreSQL for user data)
3. **Object storage** (S3 for videos)
4. **Load balancer** (for scaling)
5. **CI/CD pipeline** (GitHub Actions)
6. **Monitoring** (Sentry, Prometheus, Grafana)

We'll tackle this when you're ready!

---

## 🎬 Summary: Your Daily Commands

```bash
# Start working
./start.sh

# Monitor/debug
./monitor.sh

# Stop for the day
./stop.sh
```

That's it. Everything else is automated.

---

**Questions?** Ask Claude Code or check the logs with `./monitor.sh`

**Happy coding! 🚀**
