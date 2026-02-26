# ✅ DubVerse Docker Setup Checklist

**Complete this checklist to set up your production-ready Docker environment**

---

## 📋 Pre-Installation Checklist

### System Requirements
- [ ] Docker Desktop installed and running
  - Windows/Mac: https://docs.docker.com/desktop/
  - Linux: https://docs.docker.com/engine/install/
- [ ] Docker Compose available (`docker-compose --version`)
- [ ] 8GB+ RAM available
- [ ] 10GB+ free disk space

### API Keys Ready
- [ ] ElevenLabs API key (https://elevenlabs.io/)
- [ ] DeepL API key (https://www.deepl.com/pro-api)
- [ ] Hugging Face token (https://huggingface.co/settings/tokens)

---

## 📥 Installation Steps

### Step 1: File Organization
- [ ] Copy `docker-compose.yml` to project root
- [ ] Copy `backend-Dockerfile` to `backend/Dockerfile`
- [ ] Copy `frontend-Dockerfile` to `frontend/Dockerfile`
- [ ] Copy `.dockerignore` to project root
- [ ] Copy `.env.example` to project root
- [ ] Copy `start.sh` to project root
- [ ] Copy `stop.sh` to project root
- [ ] Copy `monitor.sh` to project root
- [ ] Copy `DEVELOPER_WORKFLOW.md` to project root
- [ ] Copy `DOCKER_SETUP_README.md` to project root

### Step 2: Script Permissions
```bash
chmod +x start.sh stop.sh monitor.sh
```
- [ ] Scripts are executable

### Step 3: Environment Setup
```bash
cp .env.example .env
```
- [ ] `.env` file created
- [ ] `ELEVENLABS_API_KEY` added to `.env`
- [ ] `DEEPL_API_KEY` added to `.env`
- [ ] `HUGGING_FACE_TOKEN` added to `.env`
- [ ] `.env` added to `.gitignore` (if not already)

### Step 4: Project Structure Verification

**Backend structure:**
```
backend/
├── Dockerfile              ✓
├── requirements.txt        ✓
└── app/
    ├── main.py            ✓
    └── ...
```
- [ ] Backend structure matches above

**Frontend structure:**
```
frontend/
├── Dockerfile              ✓
├── package.json            ✓
└── src/ or app/           ✓
```
- [ ] Frontend structure matches above

---

## 🚀 First Launch

### Launch Application
```bash
./start.sh
```

**Expected output:**
- [ ] "✓ Docker is installed"
- [ ] "✓ Docker Compose is installed"
- [ ] "✓ .env file exists"
- [ ] "✓ All pre-flight checks passed!"
- [ ] Building Docker images (takes 5-10 minutes first time)
- [ ] "✅ DUBVERSE IS RUNNING"

### Verify Services
- [ ] Frontend accessible at http://localhost:3000
- [ ] Backend accessible at http://localhost:8000
- [ ] API docs accessible at http://localhost:8000/docs
- [ ] Health check passes: `curl http://localhost:8000/health`

---

## 🧪 Testing

### Basic Functionality Tests
- [ ] Can upload a video in frontend
- [ ] Backend processes the video without errors
- [ ] Can view logs with `./monitor.sh`
- [ ] Can stop services with `./stop.sh`
- [ ] Can restart services with `./start.sh`

### Advanced Tests
- [ ] Hot reload works (edit backend code, see changes)
- [ ] Hot reload works (edit frontend code, see changes)
- [ ] ElevenLabs quota check works: `./monitor.sh` → Option 6
- [ ] Debug mode works: `./monitor.sh` → Option 9

---

## 🧹 Cleanup Old Setup

**Now that Docker is working, you can remove:**

- [ ] Delete `venv/` folder (if exists)
- [ ] Delete `venv311/` folder
- [ ] Remove old startup scripts (if any PowerShell/bash scripts)
- [ ] Uninstall redundant VS Code extensions:
  - [ ] Augment Code
  - [ ] BLACKBOXAI (both)
  - [ ] DeepSeek Copilot
  - [ ] Verdent AI
  - [ ] Codex extension
  - [ ] ACE for GitHub Copilot

**Keep these VS Code extensions:**
- [ ] GitHub Copilot (+ Chat)
- [ ] Claude Code for VS Code
- [ ] Python extensions (Pylance, Debugger, Environment)
- [ ] (Optional) CodeGeeX if you prefer it

---

## 📚 Post-Installation

### Learn the Workflow
- [ ] Read `DEVELOPER_WORKFLOW.md`
- [ ] Bookmark the monitoring menu options
- [ ] Try debug mode with `./monitor.sh`
- [ ] Practice the daily commands:
  ```bash
  ./start.sh    # Start
  ./monitor.sh  # Monitor
  ./stop.sh     # Stop
  ```

### Configure Git
- [ ] Add to `.gitignore`:
  ```
  .env
  venv/
  venv311/
  **/__pycache__/
  *.pyc
  .DS_Store
  ```

---

## 🎯 Success Criteria

You'll know the setup is complete when:

✅ You can start the entire application with one command  
✅ Code changes hot-reload automatically  
✅ You can view logs easily with the monitor script  
✅ No more "module not found" or "wrong Python" errors  
✅ Services pass health checks automatically  
✅ You can debug by shelling into containers  

---

## 🐛 Common Issues & Solutions

### Issue: Docker daemon not running
**Solution:** Start Docker Desktop and wait for it to fully initialize

### Issue: Port 8000 or 3000 already in use
**Solution:** 
```bash
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### Issue: Images fail to build
**Solution:** Check `requirements.txt` and `package.json` exist and are valid

### Issue: Services won't start
**Solution:** 
```bash
docker-compose down -v  # Stop and remove volumes
./start.sh              # Try again
```

### Issue: Can't access frontend/backend
**Solution:** 
```bash
docker-compose ps       # Check if containers are running
docker-compose logs     # Check for errors
```

---

## 🎓 Next Steps

After setup is complete:

1. **Test the full dubbing pipeline**
   - Upload a small video
   - Verify speaker diarization works
   - Check voice assignment
   - Confirm translation quality

2. **Explore the monitoring tools**
   - Try each option in `./monitor.sh`
   - Understand the logs
   - Practice debugging

3. **Optimize your workflow**
   - Set up keyboard shortcuts
   - Configure your IDE integration
   - Practice with Claude Code

4. **Plan your next features**
   - Now that infrastructure is solid
   - Focus on product features
   - Build with confidence

---

## ✨ Benefits You'll Notice

**Immediate:**
- ✅ No more environment issues
- ✅ Consistent setup across machines
- ✅ Fast startup and shutdown

**Within a Week:**
- ✅ More time coding, less time debugging setup
- ✅ Easier onboarding for collaborators
- ✅ Better monitoring and observability

**Long-term:**
- ✅ Production-ready foundation
- ✅ Easy scaling and deployment
- ✅ Professional development workflow

---

**Ready to complete the setup? Start with Step 1! 🚀**

---

## 📞 Getting Help

If you get stuck:

1. Check the troubleshooting sections in `DOCKER_SETUP_README.md`
2. Run `./monitor.sh` and check service health
3. Look at logs: `docker-compose logs`
4. Ask Claude Code: `claude "help with Docker setup"`

---

**Last updated:** February 2026  
**Questions?** Open an issue or ask Claude Code!
