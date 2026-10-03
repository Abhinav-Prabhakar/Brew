# Brew — "Night Kitchen" visual revamp (paste into a fresh chat, attach the reference image)

You're picking up **brew**, my project at `/Users/abhinav/Projects/brew`. It's a café/kitchen management game with a Python ML backend. I'm revamping the **entire visual theme** to match the attached reference image. I want something close to a replica of its vibe: a photo-realistic, high-res, real-time 3D scene with a movable camera. Treat the image as the north star for mood, lighting, materials, composition and UI. It doesn't have to be pixel-exact, but someone who has seen the image should feel it's the same world.

## What's in the repo (read before building)
- `lobby/`: the **current** frontend. It's a pink-and-white 3D café built with Three.js r160 (importmap, no bundler), pmndrs `postprocessing` with N8AO, GSAP and glass HUD cards. Leave it intact as the reference implementation and mine it for the tricks that worked: the render loop, adaptive DPR, shadow throttling, geometry merging, the dev screenshot hook, the sim-time GSAP timeline and the order and customer state machines.
- `src/brew/`: the backend (Python 3.12, **uv** only). It has a discrete-event sim, policies A to E, FastAPI with a WebSocket event stream and ML/RL. `backend.md` is the product spec: §6.3 lists every event and the visual it should drive, and §3.11 covers **Replate** (discounted pre-made food). `technical.md` is the implementation spec, and `plan.md` holds the original design notes. **Don't wire the frontend to the backend yet** unless I ask. Do structure the new frontend so a **mock event source using the same event shapes** drives it, which makes wiring later a swap-in.
- `lobby/serve.py` is a no-cache static server. `POST /__shot` saves a JPEG into `$BREW_SHOTS` (dev only). `.claude/launch.json` runs it on port 5179.

## Build target
Build a new frontend in **`kitchen/`**, a sibling of `lobby/`, served by the same server. It should be a first-person **chef's-eye view at a dark steel pass/line station in an upscale open-kitchen bistro at night**, looking out over the counter into a warmly lit dining room with tall windows full of city-light bokeh.

### The look (most important)
- **Mood:** late evening, cinematic and intimate. The scene is mostly deep shadow (near-black charcoal and graphite), painted with **warm amber practical light** at about 2700 K. Contrast is high but blacks are never crushed, and the overall feel is rich, expensive and quiet.
- **Light sources:**
  - Linear LED strips under shelves and along the ceiling coffers.
  - Brass or dark pendant lamps over the counter.
  - Glowing display-case interiors (pastry case, bottle shelves).
  - A backlit wall sign. The reference says "GOOD FOOD / BETTER DAYS"; use our own warm, short tagline in the same treatment.
  - Candle-warm table lamps in the dining room.
  - The **blue gas flame** under the pan, which should be the only cool light source.
  - Outside, a cool night city with soft bokeh through big mullioned windows.
- **Materials (PBR, physically plausible):**
  - Brushed and dark stainless steel with soft anisotropic-looking highlights and **glossy reflective counters**, where the practicals show as long streaks.
  - Black lacquer cabinetry and a worn **walnut** cutting board with real wood grain.
  - Ceramic plates, cast-iron or carbon-steel pan, glass jars, a chrome espresso machine, brass details and leather or wood dining chairs.
  - Lush green plants (pothos trailing from shelves, potted palms and monsteras) as the only saturated colour besides food and amber.
- **Food is the hero:** a steak searing in the pan with grill marks, glistening fat, herbs, and **rising steam or smoke** lit by the warm key. A Margherita pizza on the pass, a cappuccino, mise-en-place steel bins (cherry tomatoes, minced garlic, chopped herbs, chickpeas), a squeeze bottle of oil, a chef's knife on the board and a finished plated dish to the right. Food should look appetising, with sheen, subsurface warmth and crumbs.
- **First-person hands:** realistic hands and forearms in **black chef's sleeves**, one hand on the pan handle and one sprinkling herbs. Animate them subtly (idle breathing sway; actions such as flipping, sprinkling and plating).
- **Camera feel:** a 35–40 mm equivalent field of view at eye height, a slight downward tilt and gentle depth of field (foreground sharp, dining room softly defocused). Add subtle film grain, a mild vignette and gentle bloom on practicals only.

### UI (dark-glass HUD, matching the reference)
- Cards are near-black translucent glass: about rgba(14,14,16,0.72), 16–20 px backdrop blur, a 1 px hairline border at about rgba(255,255,255,0.08), 10–12 px radius and a soft drop shadow. Text is crisp white or 60 % grey, the accent is **amber/marigold** (about `#F5A623`) and status dots are green or grey. Use a clean modern sans (Inter or similar) with tabular numerals.
- **Top-left:** a sun or moon icon, "Day 3 • 12:42 PM", the phase name in amber ("Lunch Rush") and a thin amber progress bar with a small flame icon.
- **Top centre:** a row of **order ticket cards** (#12, #13, …), each with an item list, a timer and a status pill (● In Progress / ● Queued). Animate them as orders arrive, advance and complete.
- **Top-right:** a coin/cash counter and a stats button. Below them, an **objective card** with a progress ring ("Keep 3+ orders ahead · Current: 2 ahead").
- **In-world tablet (left):** an angled screen mounted on the station, showing the active recipe with checkmarks per step (Prep dough ✓, Add sauce ✓, …), the bake temperature and a photo-real thumbnail of the dish. Render it **in 3D** as a CanvasTexture or an HTML-in-3D anchor so it sits in the scene with screen glow.
- **Bottom-left:** an ingredient hot-bar of circular dark slots with photo-real ingredient icons, plus a current-task card ("Steak 2/3") with an amber progress bar.
- Animations should be restrained and premium: short eases, no bouncy cartoon motion.

### Camera and interaction
- **Default: first-person at the station.** Mouse or trackpad looks around within limits, scroll gives a slight dolly, and keys or clicks **move between stations** (grill, pass, espresso bar, pastry case) with smooth eased camera moves.
- Add an **orbit/overview mode** (a toggle) so I can fly around the kitchen and dining room freely, plus a "cinematic" idle camera.
- Clicking hot-spots (pan, tablet, tickets, ingredient slots) triggers actions. Keep the game loop from the lobby (orders → cook → plate → serve) and adapt it to the kitchen POV.

## Technical preferences (from what worked before)
- **Stack:** Three.js (latest stable via importmap from jsdelivr), pmndrs `postprocessing` (EffectComposer with HalfFloat buffers and MSAA 4), **N8AO** for ambient occlusion, mipmap Bloom at half resolution, AgX or ACES tone mapping set in the composer (the renderer exposure is ignored there), a vignette, subtle noise, and **DepthOfField** (bokeh) for the dining room. GSAP for UI and camera. No bundler: plain ES modules plus the importmap. Only use cdnjs, jsdelivr or unpkg.
- **Realism levers, roughly in order of payoff:**
  1. Real **CC0 PBR texture sets and HDRIs** from Poly Haven or ambientCG: steel, walnut, concrete or terrazzo, tile, leather and fabric, plus a night-city HDRI for reflections. Download them into `kitchen/assets/` at 1K–2K, use KTX2 or WebP where possible, and keep a `CREDITS.md`.
  2. **CC0 glTF models** (Poly Haven, Quaternius or Kenney) for props where procedural modelling would look fake. Food, pans, plants and chairs matter most.
  3. **Baked lighting** for the static set: lightmaps or baked AO. Use Blender headless (`blender -b -P bake.py`) if it's installed, otherwise PMREM env lighting plus a few shadowed lights. Dynamic lights should be only the key, the flame flicker and a couple of practicals.
  4. Volumetric-feeling steam and smoke from soft particle sprites with depth fade, light shafts done as cheap additive cones, and screen-space reflections only if the budget allows (otherwise use reflective env maps on the counters).
- **Performance is a hard requirement.** The dev machine is an **Apple M2 with 8 GB RAM** and it must run smoothly there:
  - Adaptive DPR (capped at 1.5).
  - Merge static geometry by material and use instancing.
  - Shadow maps updated every other frame, with tiny objects excluded from casting shadows.
  - Avoid `transmission` materials in the live scene; they cost a full extra render pass.
  - Run N8AO at half resolution on quality "Low", and limit the number of dynamic shadowed lights.
  - Profile with `renderer.info` and frame timing, and aim for about 16 ms per frame.
- **Lighting pitfalls I hit before:** overexposure from too many lights combined with a strong environment map (normalise `envMapIntensity` and keep light intensities physically sane), N8AO haze when combined with three's own EffectComposer (use the pmndrs pipeline), and night scenes that looked like day (darken the environment and hemisphere light properly).
- **Verification:** the in-app browser pane is often hidden, so rely on an offscreen capture hook (`B.dev.shot(name)` → `POST /__shot`) and a `?auto` dev flag that skips the intro. Take screenshots after every meaningful visual change, compare them against the reference image and iterate until it's genuinely close. Check close-ups of the hands, the food and the UI.

## Working style I want
- **Commit and push to `origin main` frequently**, after each coherent step.
- Use **uv** for anything Python.
- When I ask for heavy parallel work, delegate to **Sonnet 5.5 sub-agents** in worktrees.
- Keep the backend untouched unless asked. Do keep the mock events shaped like `backend.md §6.3` (`order.placed`, `order.progress`, `order.ready`, `order.served`, `kpi.tick`, `clock.tick`, `weather.changed`, `replate.*`, …).
- Menu source of truth: the backend SKUs in `src/brew/config/` (coffee, not-coffee, bakes and plates). It's fine to add dinner plates such as steak, pizza or pasta to the frontend visuals for this restaurant vibe, but tell me so we can add them to the backend later. Show the **Replate** category (discounted pre-made food) somewhere tasteful: a small "Replate" shelf or tag on the pass and a tab on the tablet.
- Be ambitious about visual quality. My earlier feedback was "go all in", "insanely good looking", "you can do better". Equally, it must stay runnable on this laptop.

Start by reading `lobby/js/gfx.js`, `lobby/js/game.js` and `backend.md §6.3`, and look at the reference image closely. Then propose a short build plan (scene blocking → lighting pass → materials and assets → food and hands → UI → interaction → performance pass) and start building right away.
