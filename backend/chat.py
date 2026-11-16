"""Ask Helios: a chat endpoint that answers questions about the fire the user is looking at."""
import json
import logging
import re
from typing import List, Literal, Optional

import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import config

log = logging.getLogger("helios.chat")
router = APIRouter()

MODEL = "claude-opus-5-5"
MAX_TURNS = 20          # earlier turns are dropped so a long chat stays cheap
MAX_CHARS = 2000        # per message

SYSTEM = """You are Helios, the wildfire guide inside the Helios web app (NASA Space Apps, MODIS-VIIRS harmonization).
People click a spot on a map, and the app reads satellite data for a circle or drawn shape around it over the 7 days up to the chosen date.

What the numbers mean:
- fire_pixels: active-fire pixels detected. MODIS (Terra/Aqua, since 2000) has ~1 km pixels; VIIRS (Suomi NPP, since 2012) has 375 m pixels and sees smaller fires.
  "harmonized" mode uses VIIRS from 2012 on and MODIS scaled by a VIIRS/MODIS ratio before that, so the record runs 2000 to today on one scale.
- fire_count / largest_fire_px / fire_sizes: separate fire clusters and their sizes in pixels.
- so2_du: mean sulfur dioxide (Sentinel-5P TROPOMI) in Dobson units; so2_baseline_du is the 30 days before; so2_ratio compares them. SO2 comes from smoke, volcanoes and industry.
- burned_ha: burn-scar area in hectares from Sentinel-2 imagery (before vs after, dNBR-style).
- signal / signal_reason: the app's own alert level from fire pixels and the SO2 ratio.
- reported: wildfires US agencies (NIFC WFIGS) reported in the same window; US only, from 2014.
- so2_series: daily SO2 for 30 days.

How to answer:
- Base answers on the "current view" data you are given. Say plainly when a number is missing or still loading, and never invent fire names, dates or figures.
- You can add general wildfire knowledge (behavior, smoke health, safety, how the satellites work), labeled as general.
- For anything about personal safety or evacuation, tell them to follow local officials and emergency alerts (911 in an emergency); satellite data is delayed and is not a warning system.
How to write (the chat shows plain text, so formatting symbols show up as clutter):
- Write for someone with no science background, like a curious 12-year-old or a worried neighbor.
- Start with a one-sentence direct answer. Then, if needed, up to 3 short points, each on its own line starting with "• ".
- Short sentences. Everyday words. Explain any term the first time, e.g. "fire pixels (spots where the satellite saw heat)".
- Turn numbers into meaning: round them, and say what they mean ("about 3 times more smoke gas than last month"), not just the raw value.
- Never use markdown: no **, no *, no #, no backticks, no tables, no headings.
- Keep the whole reply under about 100 words."""


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=MAX_CHARS * 4)


class ChatIn(BaseModel):
    messages: List[Turn] = Field(..., min_length=1)
    context: Optional[dict] = None


def plain(text: str) -> str:
    """Strip markdown the model might still slip in, so the chat shows clean text."""
    text = re.sub(r"\*\*(.+?)\*\*|__(.+?)__", lambda m: m.group(1) or m.group(2), text)
    text = re.sub(r"(?<!\w)\*(\S.*?\S|\S)\*(?!\w)", r"\1", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"^\s*[-*+]\s+", "• ", text, flags=re.M)
    text = text.replace("**", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


_client: Optional[anthropic.Anthropic] = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        if not config.ANTHROPIC_API_KEY:
            raise HTTPException(503, "The AI chat is off: add ANTHROPIC_API_KEY to the .env file and restart.")
        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


@router.get("/api/chat/status")
def chat_status():
    return {"enabled": bool(config.ANTHROPIC_API_KEY)}


@router.post("/api/chat")
def chat(body: ChatIn):
    turns = body.messages[-MAX_TURNS:]
    while turns and turns[0].role != "user":
        turns = turns[1:]
    if not turns or turns[-1].role != "user":
        raise HTTPException(400, "The last message must come from the user.")
    if len(turns[-1].content) > MAX_CHARS:
        raise HTTPException(400, f"Keep questions under {MAX_CHARS} characters.")

    msgs = [{"role": t.role, "content": t.content} for t in turns]
    ctx = json.dumps(body.context or {"note": "no spot picked on the map yet"}, default=str)[:12000]
    msgs[-1]["content"] = f"<current_view>\n{ctx}\n</current_view>\n\n{turns[-1].content}"

    try:
        res = client().beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=msgs,
        )
    except anthropic.AuthenticationError:
        raise HTTPException(503, "The AI chat key was rejected. Check ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError:
        raise HTTPException(429, "Too many questions right now. Try again in a minute.")
    except anthropic.APIStatusError as e:
        log.warning("chat failed: %s %s", e.status_code, e.message)
        raise HTTPException(502, "The AI couldn't answer just now. Try again.")
    except anthropic.APIConnectionError:
        raise HTTPException(502, "Couldn't reach the AI service. Check the internet connection.")

    if res.stop_reason == "refusal":
        return {"reply": "I can't help with that one. Ask me about the fire, smoke or satellite data on the map."}
    text = plain("".join(b.text for b in res.content if b.type == "text"))
    return {"reply": text or "I don't have an answer for that. Try asking another way."}
