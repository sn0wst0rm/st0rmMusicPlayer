#!/bin/bash
INPUT="/media/sn0wst0rm/megaDrive/musica/Glass Animals/Dreamland/cover-animated.mp4"
OUTPUT="/media/sn0wst0rm/megaDrive/musica/Glass Animals/Dreamland/cover-animated-seamless.gif"
Palette="/media/sn0wst0rm/megaDrive/musica/Glass Animals/Dreamland/palette-seamless.png"

# Crossfade duration in seconds
FADE_DUR=1.0
# Total duration of input is 5.0
TOTAL_DUR=5.0
# Output duration = Total - Fade
OUT_DUR=$(echo "$TOTAL_DUR - $FADE_DUR" | bc)

echo "Generating seamless loop with ${FADE_DUR}s crossfade..."

# 1. Generate palette for high quality GIF (using the crossfaded video stream)
# We use a complex filter to:
# 1. Split input into two streams
# 2. Trim stream 1 to exclude the fade-out part (0 to END-FADE)
# 3. Trim stream 2 to contain ONLY the fade-out part (END-FADE to END)
# 4. Apply fade-in to stream 2? No, we need to overlap.

# Standard Crossfade Loop Logic:
# Take last N seconds.
# Overlay them on top of the first N seconds with a fade-in.
# Trim the video to exclude the last N seconds (since they are now at the start).

ffmpeg -y -i "$INPUT" -filter_complex "
    [0]split[body][pre];
    [pre]trim=start=4:duration=1,setpts=PTS-STARTPTS[fade];
    [fade]format=yuva420p,fade=t=out:st=0:d=1:alpha=1,setpts=PTS-STARTPTS+(0/TB)[faded];
    [body]trim=duration=5,setpts=PTS-STARTPTS[main];
    [main][faded]overlay=0:0:enable='between(t,0,1)'[out];
    [out]trim=duration=4[final];
    [final]fps=25,scale=600:-1:flags=lanczos,palettegen
" "$Palette"

# 2. Generate GIF using palette
ffmpeg -y -i "$INPUT" -i "$Palette" -filter_complex "
    [0]split[body][pre];
    [pre]trim=start=4:duration=1,setpts=PTS-STARTPTS[fade];
    [fade]format=yuva420p,fade=t=out:st=0:d=1:alpha=1,setpts=PTS-STARTPTS+(0/TB)[faded];
    [body]trim=duration=5,setpts=PTS-STARTPTS[main];
    [main][faded]overlay=0:0:enable='between(t,0,1)'[out];
    [out]trim=duration=4[final];
    [final]fps=25,scale=600:-1:flags=lanczos[x];
    [x][1:v]paletteuse
" "$OUTPUT"

OUTPUT_SMALL="/media/sn0wst0rm/megaDrive/musica/Glass Animals/Dreamland/cover-animated-seamless-small.gif"
echo "Generating seamless small loop..."
ffmpeg -y -i "$INPUT" -filter_complex "
    [0]split[body][pre];
    [pre]trim=start=4:duration=1,setpts=PTS-STARTPTS[fade];
    [fade]format=yuva420p,fade=t=out:st=0:d=1:alpha=1,setpts=PTS-STARTPTS+(0/TB)[faded];
    [body]trim=duration=5,setpts=PTS-STARTPTS[main];
    [main][faded]overlay=0:0:enable='between(t,0,1)'[out];
    [out]trim=duration=4[final];
    [final]fps=15,scale=200:-1:flags=lanczos[x];
    [x]split[x1][x2];[x1]palettegen[p];[x2][p]paletteuse
" "$OUTPUT_SMALL"


echo "Done: $OUTPUT"
