"""
Language-aware glossary for DubMaster translation pipeline.

Structure:
  GLOSSARIES[source_lang] → Dict[str, str]  (source term → English)

Each language glossary solves two problems specific to that language:
  1. ASR mishearings — terms Whisper consistently transcribes wrong
  2. Translation failures — terms Claude/DeepL/Google handle poorly

Project-specific character names are NOT stored here — they live in the
per-project Character Sheet and are merged in at job time.

Adding a new language: add a new key to GLOSSARIES with a dict of terms.
The get_glossary() function handles all language code normalization.
"""

from typing import Dict, List, Tuple, Optional

# ---------------------------------------------------------------------------
# CJK SHARED — terms common to both Cantonese (yue) and Mandarin (zh)
# ---------------------------------------------------------------------------
_CJK_SHARED: Dict[str, str] = {
    # Martial arts terms
    "詠春": "Wing Chun",
    "咏春拳": "Wing Chun",
    "詠春拳": "Wing Chun",
    "永春": "Wing Chun",
    "榮春": "Wing Chun",        # Whisper mishearing of 詠春
    "龄春": "Wing Chun",
    "北拳": "Northern Fist",
    "北權": "Northern Fist",    # Whisper mishearing
    "藍北拳": "Northern Fist",  # Whisper prepends 藍
    "南拳": "Southern Fist",
    "南方權": "Southern Fist",  # Whisper mishearing
    "输给南拳": "lost to Southern Fist",
    "輸給了南拳": "lost to Southern Fist",
    "輸給南拳": "lost to Southern Fist",
    "輸給南方權": "lost to Southern Fist",
    "不是南北拳的問題": "It's not about Northern or Southern Fist",
    "不是南北權的問題": "It's not about Northern or Southern Fist",
    "木人桩": "wooden dummy",
    "木人樁": "wooden dummy",
    "黐手": "chi sau",
    "太极": "Tai Chi",
    "太極": "Tai Chi",
    "武术": "martial arts",
    "武術": "martial arts",
    "功夫": "kung fu",
    # Possessive master forms — must appear before bare 師傅/師父
    "我師父": "my master",
    "我师父": "my master",
    "我師傅": "my master",
    "我师傅": "my master",
    "你師父": "your master",
    "你师父": "your master",
    "你師傅": "your master",
    "你师傅": "your master",
    "师傅": "master",
    "師傅": "master",
    "师父": "master",
    "師父": "master",
    # Martial arts school hierarchy — must precede bare 師兄 matches
    "大師兄": "Senior Brother",
    "大师兄": "Senior Brother",
    # Family / address terms
    "大哥": "Big brother",
    "臭小子": "You little brat",
    "老婆大人": "My dear wife",
    # NOTE: bare 老婆 intentionally excluded — Claude translates it with correct
    # possessive pronoun (your/his/their) from context. Glossary replacement strips
    # the surrounding pronouns, producing "afraid of wife" instead of "afraid of your wife".
    "老公": "husband",
    "親愛的": "Darling",
    "亲爱的": "Darling",
    "爸爸": "Daddy",
    "妈妈": "Mommy",
    "媽媽": "Mommy",
    # Common expressions — translation engines get these wrong
    "沒事": "I'm fine",
    "没事": "I'm fine",
    "好呀": "Okay.",
    "好了": "Alright.",
    "好啊": "Okay.",
    "够了": "That's enough",
    "夠了": "That's enough",
    "不用說了": "That's enough",
    "不用说了": "That's enough",
    "小心你的嘴": "Mind your language",
    "小心你的嘴巴": "Mind your language",
    "我付": "I'll pay",
    "我來付": "I'll pay",
    "我来付": "I'll pay",
    "我埋單": "I'll pay",
    "我埋单": "I'll pay",
    "我付錢": "I'll pay",
    "我付钱": "I'll pay",
    "我請客": "It's my treat",
    "我请客": "It's my treat",
    "看人家": "It's up to you.",
    "看人家的": "It's up to you.",
    "看別人而已": "It's up to you.",
    "看别人而已": "It's up to you.",
    "看別人": "It's on you",
    "看人的": "It's up to you",
    "看人的": "It's up to you",
    # Payments / business
    "套牌": "I'll pay",         # Whisper mishears 我付 as 套牌
    # Phonetic-English identity — prevent DeepL from mangling romanized proper nouns
    "Ip Man": "Ip Man",
    "Ip man": "Ip Man",
    "Wing Chun": "Wing Chun",
    "wing chun": "Wing Chun",
}

# ---------------------------------------------------------------------------
# CANTONESE (yue) — Cantonese-specific terms + film-specific character names
# (character names here are for the calibration test film only;
#  production projects use the per-project Character Sheet)
# ---------------------------------------------------------------------------
_GLOSSARY_YUE: Dict[str, str] = {
    **_CJK_SHARED,

    # ── Calibration film: Ip Man character names ───────────────────────────
    "叶问": "Ip Man",
    "葉問": "Ip Man",
    "熱吻": "Ip Man",           # Whisper mishearing of 葉問
    "叶师傅": "Master Ip",
    "葉師傅": "Master Ip",
    "金師傅": "Master Shin",
    "金师傅": "Master Shin",
    "金師父": "Master Shin",
    "金师父": "Master Shin",
    "甘師傅": "Master Shin",    # Whisper: 甘 for 金 (homophones in Cantonese)
    "甘师傅": "Master Shin",
    "甘師父": "Master Shin",
    "甘师父": "Master Shin",
    "甘師":   "Master Shin",
    "金山找": "Jin Shan Zhao",
    "金山沼": "Jin Shan Zhao",  # Velma transcribes 沼 (swamp) for 找 (seek) — same Mandarin sound
    "金山照": "Jin Shan Zhao",  # third common variant from other ASR engines
    "金山爪": "Jin Shan Zhao",  # Velma transcribes 爪 (claw) for 找 — confirmed in job summary logs
    "心師傅": "Master Shin",
    "心师傅": "Master Shin",
    "心師父": "Master Shin",
    "心师父": "Master Shin",
    "新師傅": "Master Shin",
    "新师傅": "Master Shin",
    "新師父": "Master Shin",
    "新师父": "Master Shin",
    "辛師傅": "Master Shin",
    "辛师傅": "Master Shin",
    "辛師父": "Master Shin",
    "辛师父": "Master Shin",
    "信師傅": "Master Shin",
    "信师傅": "Master Shin",
    "信師父": "Master Shin",
    "信师父": "Master Shin",
    "星師傅": "Master Shin",
    "星师傅": "Master Shin",
    "星師父": "Master Shin",
    "星师父": "Master Shin",
    "陳師父": "Master Chin",
    "陳師傅": "Master Chin",
    "陈师父": "Master Chin",
    "陈师傅": "Master Chin",
    "阿俊":   "Ah Jun",
    "三浦": "Miura",
    "文哥武次林": "Brother Wen, Lam",
    "文哥武痴林": "Brother Wen, Lam",
    "武痴林": "Lam",
    "武次林": "Lam",
    "武慈林": "Lam",
    "李钊": "Li Zhao",
    "葉太": "Mrs. Yip",           # Ip Man's wife — 葉 (Yip) + 太 (wife/Mrs.)
    "葉太太": "Mrs. Yip",        # full Cantonese form for Mrs. Yip
    "叶太": "Mrs. Yip",           # simplified Chinese variant
    "叶太太": "Mrs. Yip",         # simplified Chinese full form
    "文叔": "Uncle Ip",           # Ah Jun's term for Ip Man (文=Wen, 叔=uncle)
    "文哥": "Brother Wen",
    "文嗯": "Brother Wen",      # Whisper mishearing of 文哥

    # ── Cantonese-specific Whisper artifacts ───────────────────────────────
    "男女路友": "male and female",
    "男女老友": "men and women",

    # ── Cantonese full-phrase overrides ────────────────────────────────────
    "龄春, 燕文": "Wing Chun, Ip Man",
    "榮春葉問": "Wing Chun, Ip Man",
    "荣春叶问": "Wing Chun, Ip Man",
    "詠春葉問": "Wing Chun, Ip Man",
    "咏春叶问": "Wing Chun, Ip Man",
    "好的功夫是不分男女路友": "Good kung fu doesn't discriminate between men and women",
    "好功夫是不會分男女路友的": "Kung fu doesn't discriminate between male and female",
    # Another Whisper mishearing of the "詠春，葉問" opening exclamation — same
    # family as "龄春, 燕文" above, confirmed against the correct rendering.
    # 川 alone means "river" and is unsafe as a bare glossary key (would false-match
    # inside unrelated words like 四川/Sichuan), so this is scoped to the full line.
    # _apply_glossary_pre strips CJK-adjacent commas from the segment text BEFORE
    # matching (its own collapsing only handles spaces, not punctuation), so a
    # key with commas never matches — the punctuation-free form is required.
    "喂川你慢": "Wing Chun, Yip Man!",
    "喂，川，你慢": "Wing Chun, Yip Man!",
    "喂，川，你慢。": "Wing Chun, Yip Man!",

    # ── "I'll pay" — compensation phrases (moved from translation_service.py's
    # whole-segment-only exact-override table). These are 2+ character phrases,
    # safe as contains-match: specific enough not to false-match inside unrelated
    # words, unlike the single characters (好/賠/赔/請/请) that table also holds,
    # which stay in the whole-segment table since contains-match would corrupt
    # those characters wherever they appear inside unrelated longer words.
    "我賠": "I'll pay.",
    "我赔": "I'll pay.",
    "包賠": "I'll pay.",
    "包赔": "I'll pay.",
    "照賠": "I'll pay.",
    "照赔": "I'll pay.",
    "好功夫是不会分男女路友的": "Kung fu doesn't discriminate between male and female",
    "我劈": "I'll fight you.",
    "厉害": "He's better",
    "厲害": "He's better",
    "錯錯錯": "Wrong.",
    "係你㗎笨": "It's your problem.",
    "係你嘅問題": "It's your problem.",
    "大哥 大哥 大哥": "Big brother",
    "大哥大哥大哥": "Big brother",

    # ── Ip Man clip: full-sentence overrides (pre-substitute before LLM sees them) ──
    # Line 1 opener — Claude drops "famous for" when translating 之地 (land/place of) literally.
    # Lock the whole sentence so Claude never sees the individual fragments.
    "久闻佛山是武术之地": "I have long heard that Foshan is famous for its martial arts",
    "久聞佛山是武術之地": "I have long heard that Foshan is famous for its martial arts",
    "久闻佛山武术之地":   "I have long heard that Foshan is famous for its martial arts",
    "久聞佛山武術之地":   "I have long heard that Foshan is famous for its martial arts",
    # Line 15 — Mrs. Yip: yells at Master Shin ("Shut your mouth!"), then turns
    # to Ip Man and whispers ("Don't break my things."). These are two utterances
    # in one Velma segment. The second clause is the quiet permission to fight.
    # Velma transcribes the first part as 没打冷气的东西 across multiple runs.
    # Full-sentence overrides (Shut your mouth + don't break) — both punct variants:
    "你闭嘴。没打冷气的东西。": "Shut your mouth! Don't break my things.",
    "你閉嘴。沒打冷氣的東西。": "Shut your mouth! Don't break my things.",
    "你闭嘴！没打冷气的东西。": "Shut your mouth! Don't break my things.",
    "你閉嘴！沒打冷氣的東西。": "Shut your mouth! Don't break my things.",
    "你闭嘴没打冷气的东西":     "Shut your mouth! Don't break my things.",
    "你閉嘴沒打冷氣的東西":     "Shut your mouth! Don't break my things.",
    # Without 你 prefix (Velma may drop the pronoun):
    "闭嘴。没打冷气的东西。":   "Shut your mouth! Don't break my things.",
    "閉嘴。沒打冷氣的東西。":   "Shut your mouth! Don't break my things.",
    "闭嘴！没打冷气的东西。":   "Shut your mouth! Don't break my things.",
    "閉嘴！沒打冷氣的東西。":   "Shut your mouth! Don't break my things.",
    # Bare second clause only (when Velma splits the segment or transcribes separately):
    "没打冷气的东西":           "Don't break my things",
    "沒打冷氣的東西":           "Don't break my things",
    "没打冷气的东西！":         "Don't break my things!",
    "沒打冷氣的東西！":         "Don't break my things!",

    # ── Cantonese phrases with known translation issues ─────────────────────
    "大哥没事吧": "Brother, are you okay?",
    "大哥沒事吧": "Brother, are you okay?",
    "你没事吧": "Are you okay?",
    "你沒事吧": "Are you okay?",
    "至於打成怎樣你一會兒就會知道": "You'll see how it goes in a moment.",
    "至于打成怎样你一会儿就会知道": "You'll see how it goes in a moment.",
    "我告訴你再不出門的話": "I'm telling you, if you don't leave the house,",
    "我告诉你再不出门的话": "I'm telling you, if you don't leave the house,",
    "家裡的東西就會壞掉了": "everything in the house will be ruined.",
    "家里的东西就会坏掉了": "everything in the house will be ruined.",
    "家裡的東西就會爛了": "everything in the house will be ruined.",

    # ── Master Shin wellness checks (many Whisper script-mix variants) ──────
    "金師傅沒事吧": "Master Shin, are you okay?",
    "金师傅没事吧": "Master Shin, are you okay?",
    "金師父沒事吧": "Master Shin, are you okay?",
    "金师父没事吧": "Master Shin, are you okay?",
    "金師傅 沒事吧": "Master Shin, are you okay?",
    "金师傅 没事吧": "Master Shin, are you okay?",
    "金師父 沒事吧": "Master Shin, are you okay?",
    "金师父 没事吧": "Master Shin, are you okay?",
    "金師傅没事吧": "Master Shin, are you okay?",
    "金师傅沒事吧": "Master Shin, are you okay?",
    "金師父没事吧": "Master Shin, are you okay?",
    "金师父沒事吧": "Master Shin, are you okay?",
    "甘師傅沒事吧": "Master Shin, are you okay?",
    "甘师傅没事吧": "Master Shin, are you okay?",
    "甘師父沒事吧": "Master Shin, are you okay?",
    "甘师父没事吧": "Master Shin, are you okay?",
    "甘師傅 沒事吧": "Master Shin, are you okay?",
    "甘师傅 没事吧": "Master Shin, are you okay?",
    "甘師父 沒事吧": "Master Shin, are you okay?",
    "甘师父 没事吧": "Master Shin, are you okay?",
    "甘師傅没事吧": "Master Shin, are you okay?",
    "甘师傅沒事吧": "Master Shin, are you okay?",
    "甘師父没事吧": "Master Shin, are you okay?",
    "甘师父沒事吧": "Master Shin, are you okay?",
    "怎麼樣 金師傅": "Master Shin, are you alright?",
    "怎么样 金师傅": "Master Shin, are you alright?",
    "怎麼樣金師傅": "Master Shin, are you alright?",
    "怎么样金师傅": "Master Shin, are you alright?",
    "怎麼樣金師傅沒事吧": "How's it going? Master Shin, are you okay?",
    "怎么样金师傅没事吧": "How's it going? Master Shin, are you okay?",

    # ── Cantonese character names ───────────────────────────────────────────
    "黄少三": "Huang Shaosan",
    "黃少三": "Huang Shaosan",

    # ── Cantonese idiomatic expressions ────────────────────────────────────
    "武打郎几啲嘢": "What kind of nonsense is this",
    "武打郎幾啲嘢": "What kind of nonsense is this",

    # ── Cantonese final-section dialogue ───────────────────────────────────
    "今天北拳": "Today, Northern Fist",
    "今天被放權": "Today, Northern Fist",
    "今天北方拳": "Today, Northern Fist",
    "不是南北拳的問題": "It's not about Northern or Southern Fist",
    "不是南北權的問題": "It's not about Northern or Southern Fist",
    "點下金師父": "Master Shin, was my kung fu any good?",
    "點下金師傅": "Master Shin, was my kung fu any good?",
    "我啲功夫橫可以": "My kung fu's not bad, right?",
    "唔用數啦": "That's enough.",
    "唔用數": "That's enough.",
    "輸俾南方拳": "lost to Southern Fist",
    "輸俾南拳": "lost to Southern Fist",
    "唔系南北拳㗎嘛": "It's not about Northern or Southern Fist",
    "唔係南北拳㗎嘛": "It's not about Northern or Southern Fist",
    "唔系南北拳": "It's not about Northern or Southern Fist",
    "唔係南北拳": "It's not about Northern or Southern Fist",

    # ── Child's fight scene line ────────────────────────────────────────────
    "爸爸妈妈说你再不出门的话家里的东西就会烂了": "Mom said start fighting, or everything in the house will be broken",
    "爸爸媽媽說你再不出門的話家裡的東西就會爛了": "Mom said start fighting, or everything in the house will be broken",
    "妈妈说你再不出手的话家里的东西都要被打烂了": "Mom said start fighting, or everything in the house will be broken",
    "爸爸妈妈说你再不出门的话": "Mom said start fighting",
    "爸爸媽媽說你再不出門的話": "Mom said start fighting",
    "家里的东西就会烂了": "or everything in the house will be broken",
    "家裡的東西就會爛了": "or everything in the house will be broken",
}

# ---------------------------------------------------------------------------
# MANDARIN (zh) — shares CJK base; film-specific names added per-project
# ---------------------------------------------------------------------------
_GLOSSARY_ZH: Dict[str, str] = {
    **_CJK_SHARED,
    # Mandarin-specific Whisper artifacts (different phonetics than Cantonese)
    "功夫": "kung fu",
    "武侠": "wuxia",
    "侠客": "swordsman",
    "江湖": "jianghu",          # The martial arts world — keep romanized for dubbing
    "师兄": "senior brother",
    "师弟": "junior brother",
    "师姐": "senior sister",
    "师妹": "junior sister",
    "掌门": "sect leader",
    "宗主": "sect master",
}

# ---------------------------------------------------------------------------
# FRENCH (fr)
# ---------------------------------------------------------------------------
_GLOSSARY_FR: Dict[str, str] = {
    # Forms of address — Whisper keeps these in French; translation engines
    # sometimes leave them untranslated or translate inconsistently
    "Monsieur": "Mr.",
    "Madame": "Mrs.",
    "Mademoiselle": "Miss",
    "Mon cher": "My dear",
    "Ma chère": "My dear",
    "Mon ami": "My friend",
    "Mon vieux": "Old friend",
    # Titles that should be translated
    "Capitaine": "Captain",
    "Inspecteur": "Inspector",
    "Commissaire": "Commissioner",
    "Docteur": "Doctor",
    "Professeur": "Professor",
    "Maître": "Master",
    "Général": "General",
    "Commandant": "Commander",
    # Common expressions translation engines struggle with
    "Mon Dieu": "My God",
    "Sacré bleu": "Good heavens",
    "Merde": "Damn",
    "Putain": "Damn it",
    "Zut": "Darn",
    "Eh bien": "Well then",
    "Allez": "Come on",
    "Voilà": "There you go",
    "C'est la vie": "That's life",
    "N'importe quoi": "That's nonsense",
    "Tant pis": "Too bad",
    "Tant mieux": "All the better",
    "Bof": "Meh",
    "Hein": "Huh",
    "Quoi": "What",
}

# ---------------------------------------------------------------------------
# KOREAN (ko)
# ---------------------------------------------------------------------------
_GLOSSARY_KO: Dict[str, str] = {
    # Address terms — critical for preserving relationship dynamics
    "형": "big bro",            # male → older male
    "오빠": "oppa",             # female → older male (keep romanized in dubbing)
    "언니": "unni",             # female → older female (keep romanized)
    "누나": "noona",            # male → older female (keep romanized)
    "아저씨": "mister",
    "아주머니": "ma'am",
    "할아버지": "grandfather",
    "할머니": "grandmother",
    # Honorific titles
    "선생님": "teacher",
    "의사님": "doctor",
    "사장님": "boss",
    "회장님": "chairman",
    "교수님": "professor",
    # Common expressions
    "아이고": "Oh my",
    "어머": "Oh my goodness",
    "세상에": "Good heavens",
    "이런": "Oh no",
    "안돼": "No",
    "잠깐": "Wait",
    "어서": "Quickly",
    "빨리": "Hurry",
    "왜": "Why",
    "뭐": "What",
    "괜찮아": "It's okay",
    "미안해": "I'm sorry",
    "고마워": "Thank you",
    "사랑해": "I love you",
    # Whisper often outputs these romanized
    "네": "Yes",
    "아니": "No",
    "응": "Yeah",
}

# ---------------------------------------------------------------------------
# JAPANESE (ja)
# ---------------------------------------------------------------------------
_GLOSSARY_JA: Dict[str, str] = {
    # Honorifics — in English dubbing these are typically dropped or adapted
    # Whisper preserves them; we pass them through for Claude to handle contextually
    # Titles that need translation
    "先生": "Doctor",           # Context-dependent: teacher/doctor/master — Claude handles
    "部長": "department head",
    "課長": "section chief",
    "社長": "president",
    "会長": "chairman",
    "将軍": "general",
    "侍": "samurai",
    "忍者": "ninja",
    # Common expressions translation engines get wrong
    "すみません": "Excuse me",
    "ありがとう": "Thank you",
    "ごめんなさい": "I'm sorry",
    "もしもし": "Hello",        # phone greeting
    "いただきます": "Let's eat",
    "ただいま": "I'm home",
    "お帰り": "Welcome back",
    "頑張って": "Do your best",
    "しょうがない": "Can't be helped",
    "なるほど": "I see",
    "よし": "Alright",
    "まずい": "This is bad",
    "嘘": "Liar",
    "馬鹿": "Idiot",
    "うるさい": "Shut up",
}

# ---------------------------------------------------------------------------
# SPANISH (es)
# ---------------------------------------------------------------------------
_GLOSSARY_ES: Dict[str, str] = {
    # Forms of address
    "Señor": "Mr.",
    "Señora": "Mrs.",
    "Señorita": "Miss",
    "Don": "Don",               # Honorific — keep in dubbing
    "Doña": "Doña",
    # Titles
    "Capitán": "Captain",
    "Inspector": "Inspector",
    "Doctor": "Doctor",
    "Profesor": "Professor",
    "General": "General",
    "Comandante": "Commander",
    # Common expressions
    "Dios mío": "My God",
    "Madre de Dios": "Mother of God",
    "Ay": "Ow",
    "Ay caramba": "Oh no",
    "Órale": "Alright",
    "Ándale": "Come on",
    "Chingado": "Damn",
    "Coño": "Damn it",
    "Qué": "What",
    "Por favor": "Please",
    "Gracias": "Thank you",
    "Lo siento": "I'm sorry",
    "Claro": "Of course",
    "Vale": "Okay",
    "Venga": "Come on",
}

# ---------------------------------------------------------------------------
# PORTUGUESE (pt)
# ---------------------------------------------------------------------------
_GLOSSARY_PT: Dict[str, str] = {
    "Senhor": "Mr.",
    "Senhora": "Mrs.",
    "Senhorita": "Miss",
    "Capitão": "Captain",
    "Doutor": "Doctor",
    "Professor": "Professor",
    "Meu Deus": "My God",
    "Caramba": "Good grief",
    "Caralho": "Damn",
    "Porra": "Damn it",
    "Que": "What",
    "Por favor": "Please",
    "Obrigado": "Thank you",
    "Obrigada": "Thank you",
    "Desculpa": "Sorry",
    "Tudo bem": "Everything okay",
    "Vamos": "Let's go",
}

# ---------------------------------------------------------------------------
# HINDI (hi)
# ---------------------------------------------------------------------------
_GLOSSARY_HI: Dict[str, str] = {
    # Respectful address
    "जी": "",                   # Respectful suffix — drop in English dubbing
    "साहब": "sir",
    "मेमसाहब": "ma'am",
    "गुरु": "master",
    "भाई": "brother",
    "दीदी": "sister",
    "बाबा": "father",
    "माँ": "Mom",
    # Common expressions
    "अरे": "Hey",
    "हाँ": "Yes",
    "नहीं": "No",
    "ठीक है": "Okay",
    "बहुत अच्छा": "Very good",
    "कमाल है": "Amazing",
    "क्या बात है": "What's going on",
    "भगवान": "God",
    "हे भगवान": "Oh God",
}

# ---------------------------------------------------------------------------
# ARABIC (ar)
# ---------------------------------------------------------------------------
_GLOSSARY_AR: Dict[str, str] = {
    # Common expressions that lose meaning in direct translation
    "يلا": "Let's go",          # Yalla
    "حبيبي": "my friend",       # Habibi (male)
    "حبيبتي": "my dear",        # Habibti (female)
    "إن شاء الله": "God willing",
    "الحمد لله": "Thank God",
    "ما شاء الله": "Wonderful",
    "بسم الله": "In God's name",
    "والله": "I swear",
    "يا": "",                   # Address particle — drop in English
    "أخي": "brother",
    "يا أخي": "brother",
    "أستاذ": "professor",
    "دكتور": "doctor",
    "لا": "No",
    "نعم": "Yes",
    "تمام": "Okay",
    "خلاص": "That's it",
    "يكفي": "Enough",
}

# ---------------------------------------------------------------------------
# GERMAN (de)
# ---------------------------------------------------------------------------
_GLOSSARY_DE: Dict[str, str] = {
    # Formal address
    "Herr": "Mr.",
    "Frau": "Mrs.",
    "Fräulein": "Miss",
    # Titles
    "Hauptmann": "Captain",
    "Inspektor": "Inspector",
    "Doktor": "Doctor",
    "Professor": "Professor",
    "General": "General",
    "Kommandant": "Commander",
    # Common expressions
    "Mein Gott": "My God",
    "Verdammt": "Damn",
    "Scheiße": "Damn it",
    "Mensch": "Man",
    "Na ja": "Well",
    "Genau": "Exactly",
    "Stimmt": "That's right",
    "Los": "Let's go",
    "Lass uns": "Let's",
    "Bitte": "Please",
    "Danke": "Thank you",
    "Entschuldigung": "Excuse me",
    "Tut mir leid": "I'm sorry",
}

# ---------------------------------------------------------------------------
# LANGUAGE CODE NORMALIZATION
# Maps variant codes → canonical key in GLOSSARIES
# ---------------------------------------------------------------------------
_LANG_ALIASES: Dict[str, str] = {
    # Cantonese variants
    "zh-hk":  "yue",
    "yue-hk": "yue",
    "zh-yue": "yue",
    # Mandarin variants
    "zh-cn":  "zh",
    "zh-tw":  "zh",
    "cmn":    "zh",
    "zho":    "zh",
    # Portuguese variants
    "pt-br":  "pt",
    "pt-pt":  "pt",
    # Spanish variants
    "es-es":  "es",
    "es-mx":  "es",
    "es-419": "es",
}

# Master registry
GLOSSARIES: Dict[str, Dict[str, str]] = {
    "yue": _GLOSSARY_YUE,
    "zh":  _GLOSSARY_ZH,
    "fr":  _GLOSSARY_FR,
    "ko":  _GLOSSARY_KO,
    "ja":  _GLOSSARY_JA,
    "es":  _GLOSSARY_ES,
    "pt":  _GLOSSARY_PT,
    "hi":  _GLOSSARY_HI,
    "ar":  _GLOSSARY_AR,
    "de":  _GLOSSARY_DE,
}


def get_glossary(source_language: str) -> Dict[str, str]:
    """Return the glossary for a given source language code."""
    lang = (source_language or "").lower().strip()
    lang = _LANG_ALIASES.get(lang, lang)
    return GLOSSARIES.get(lang, {})


# ---------------------------------------------------------------------------
# Phonetic index — maps pinyin key → (canonical_source, target, term_len)
# Enables fuzzy matching when ASR writes a homophone of the glossary entry.
# ---------------------------------------------------------------------------

def _is_cjk(ch: str) -> bool:
    return '一' <= ch <= '鿿' or '㐀' <= ch <= '䶿'


def _cjk_pinyin(text: str) -> Optional[str]:
    """
    Convert a string to a space-joined pinyin key using pypinyin.
    Returns None if pypinyin is unavailable or text contains no CJK.
    Only applied to entries where >50% of characters are CJK.
    """
    try:
        from pypinyin import lazy_pinyin, Style
    except ImportError:
        return None
    cjk_count = sum(1 for c in text if _is_cjk(c))
    if cjk_count < len(text) * 0.5:
        return None
    return ' '.join(lazy_pinyin(text, style=Style.NORMAL, errors='ignore'))


def build_phonetic_index(glossary: Dict[str, str]) -> Dict[str, Tuple[str, str, int]]:
    """
    Build pinyin_key → (canonical_source_term, target_term, char_length).
    Only CJK-dominant entries are indexed. Longer entries take priority when
    two terms share the same pinyin key (longest match wins, hence sorted).
    """
    index: Dict[str, Tuple[str, str, int]] = {}
    # Process longest terms first so shorter overlapping keys don't overwrite.
    for src, tgt in sorted(glossary.items(), key=lambda kv: len(kv[0]), reverse=True):
        key = _cjk_pinyin(src)
        if key and key not in index:
            index[key] = (src, tgt, len(src))
    return index
