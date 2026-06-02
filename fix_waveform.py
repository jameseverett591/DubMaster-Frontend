import re

path = 'components/editor/dubverse-editor.tsx'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix canvas height
content = content.replace('canvas.height = 60;', 'canvas.height = 96;')

# Fix waveform amplitude (use full height)
content = content.replace('(v - 1) * middleY * 0.5', '(v - 1) * middleY')

# Remove top-half background fill
content = content.replace(
    "ctx.fillRect(0, 0, canvas.width, canvas.height / 2)",
    "// waveform uses full track height"
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Waveform fixes applied')
