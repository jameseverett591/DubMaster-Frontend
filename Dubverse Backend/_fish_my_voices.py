import os, asyncio
from fishaudio import AsyncFishAudio

async def main():
    c = AsyncFishAudio(api_key=os.environ["FISH_AUDIO_API_KEY"])
    all_items = []
    page = 1
    while True:
        resp = await c.voices.list(self_only=True, page_size=50, page_number=page)
        items = list(resp.items)
        if not items:
            break
        all_items.extend(items)
        # Stop if fewer than page_size returned
        if len(items) < 50:
            break
        page += 1

    print(f"Total custom voices in this account: {len(all_items)}\n")
    if not all_items:
        print("(none — no personally cloned voices found under FISH_AUDIO_API_KEY)")
        return

    for v in all_items:
        tags = getattr(v, "tags", None) or []
        desc = (getattr(v, "description", "") or "").strip().replace("\n", " ")
        print(f"--- {getattr(v, 'title', '(untitled)')} ---")
        print(f"  id:          {v.id}")
        print(f"  visibility:  {getattr(v, 'visibility', None)}")
        print(f"  languages:   {getattr(v, 'languages', None)}")
        print(f"  tags:        {tags}")
        print(f"  description: {desc}")
        print(f"  created_at:  {getattr(v, 'created_at', None)}")
        print(f"  task_count:  {getattr(v, 'task_count', 0)}")
        print(f"  train_mode:  {getattr(v, 'train_mode', None)}")
        print(f"  state:       {getattr(v, 'state', None)}")
        print()

asyncio.run(main())
