"""The logo gateway: what an uploaded picture goes through before it is kept (margins trimmed, a letterhead's logo found, a plain background taken
off, a block logo and a white background left alone, a white logo and a low resolution flagged, an SVG drawn without running anything in it) and the
size each export prints it at."""
import io

import pytest
from PIL import Image, ImageDraw

from grc.modules.governance.studio import exporters as X
from grc.modules.governance.studio import logo_gateway as G

from test_studio_export import png, upload                                  # noqa: F401
from test_studio_flow import world                                          # noqa: F401  (world is a fixture)

BLUE = (24, 92, 160, 255)
WHITE = (255, 255, 255, 255)
GREY = (232, 232, 236, 255)


def picture(size, background, shapes, fmt="PNG"):
    img = Image.new("RGBA", size, background)
    d = ImageDraw.Draw(img)
    for box, fill in shapes:
        d.rectangle(box, fill=fill)
    out = io.BytesIO()
    (img.convert("RGB") if fmt == "JPEG" else img).save(out, fmt)
    return out.getvalue()


def codes(done):
    return [n["code"] for n in done.notes]


def opened(done):
    return Image.open(io.BytesIO(done.data)).convert("RGBA")


def test_the_empty_border_around_a_logo_is_trimmed_so_it_prints_at_the_size_it_should():
    done = G.prepare(picture((1200, 900), WHITE, [((440, 330, 760, 470), BLUE), ((500, 380, 700, 420), WHITE)], "JPEG"), "logo.jpg")
    assert "trimmed" in codes(done) and done.width < 400 and done.height < 200
    assert done.mime == "image/png"                                          # saved again as a clean PNG


def test_a_tight_logo_is_left_as_it_is():
    done = G.prepare(picture((300, 100), (0, 0, 0, 0), [((0, 0, 299, 99), BLUE), ((40, 30, 200, 70), WHITE)]), "logo.png")
    assert "trimmed" not in codes(done) and (done.width, done.height) == (300, 100)


def test_a_letterhead_gives_its_logo_not_the_address_lines_under_it():
    shapes = [((70, 60, 300, 170), BLUE), ((100, 90, 260, 140), WHITE)] + [((70, 700 + i * 40, 900, 716 + i * 40), (120, 120, 120, 255)) for i in range(5)]
    done = G.prepare(picture((1400, 1000), WHITE, shapes), "letterhead.png")
    assert "extracted" in codes(done) and done.width < 330 and done.height < 160


def test_a_plain_background_comes_off_a_white_one_stays_and_a_logo_light_on_its_own_block_is_kept():
    logo = [((200, 120, 520, 260), BLUE), ((250, 160, 480, 220), WHITE)]
    grey = G.prepare(picture((900, 400), GREY, logo), "screenshot.png")
    img = opened(grey)
    assert "background_removed" in codes(grey) and img.getpixel((0, 0))[3] == 0 and img.getpixel((img.width // 2, img.height // 2))[3] == 255
    white = G.prepare(picture((900, 400), WHITE, logo), "white.png")
    assert "background_removed" not in codes(white) and Image.open(io.BytesIO(white.data)).mode == "RGB"      # white paper: nothing to take off
    tile = G.prepare(picture((560, 160), BLUE, [((30, 40, 520, 120), WHITE)]), "tile.png")
    assert codes(tile) == ["block"] and (tile.width, tile.height) == (560, 160) and Image.open(io.BytesIO(tile.data)).mode == "RGB"


def test_a_white_logo_on_transparency_and_a_low_resolution_are_flagged():
    white_logo = G.prepare(picture((520, 140), (0, 0, 0, 0), [((20, 20, 300, 120), WHITE)]), "white.png")
    assert [n["level"] for n in white_logo.notes if n["code"] == "too_light"] == ["warn"]
    assert "low_resolution" in codes(G.prepare(picture((70, 20), WHITE, [((2, 2, 60, 15), BLUE)]), "tiny.png"))
    assert "low_resolution" not in codes(G.prepare(picture((900, 300), WHITE, [((50, 50, 850, 250), BLUE)]), "sharp.png"))


def test_one_flat_colour_is_used_as_it_is_and_the_original_option_keeps_the_picture_untouched():
    flat = G.prepare(png(size=(120, 60)), "flat.png")
    assert (flat.width, flat.height) == (120, 60) and "trimmed" not in codes(flat)
    padded = picture((900, 700), WHITE, [((300, 250, 600, 450), BLUE)])
    original = G.prepare(padded, "logo.png", process=False)
    assert (original.width, original.height) == (900, 700) and original.notes == []
    jpeg = G.prepare(picture((300, 200), WHITE, [((10, 10, 100, 100), BLUE)], "JPEG"), "logo.jpg", process=False)
    assert jpeg.mime == "image/jpeg"                                         # the original's own format when nothing is tidied


SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500"><script>alert(1)</script>'
       b'<rect x="300" y="190" width="300" height="120" rx="20" fill="#185ca0" onclick="x()"/><rect x="330" y="230" width="240" height="40" fill="#fff"/></svg>')


def test_an_svg_is_drawn_without_running_anything_in_it_and_trimmed():
    done = G.prepare(SVG, "logo.svg")
    assert done.mime == "image/png" and "svg" in codes(done) and "trimmed" in codes(done)
    assert done.data.startswith(b"\x89PNG") and b"alert" not in done.data and done.width > 200
    clean = G._sanitize_svg(SVG + b"")
    assert b"script" not in clean and b"onclick" not in clean
    linked = G._sanitize_svg(b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">'
                             b'<image xlink:href="http://example.com/x.png" width="10" height="10"/><use xlink:href="#a"/></svg>')
    assert b"example.com" not in linked and b"#a" in linked                  # a link outside the file goes, a reference inside it stays


@pytest.mark.parametrize("raw,name", [
    (b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "empty.svg"),
    (b"<html><body>not a logo</body></html>", "page.svg"),
    (b"MZ\x90\x00 not a picture", "logo.png"),
    (b"", "logo.png"),
    (b'<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" width="5" height="5">&a;</svg>', "entity.svg"),
])
def test_what_cannot_be_a_logo_is_refused_with_a_sentence(raw, name):
    with pytest.raises(G.LogoError) as caught:
        G.prepare(raw, name)
    assert str(caught.value) and "Traceback" not in str(caught.value)


def test_a_logo_is_printed_as_large_as_its_box_allows_without_changing_its_shape():
    w, h = G.fit_cm(2400, 200, "header")
    assert (round(w, 2), round(h, 2)) == (6.0, 0.5)                          # a long wordmark stops at the box's width
    w, h = G.fit_cm(100, 400, "header")
    assert round(h, 2) == 1.3 and round(w, 3) == 0.325                       # a tall mark stops at the box's height
    w, h = G.fit_cm(500, 500, "footer")
    assert round(h, 2) == 0.9 and round(w, 2) == 0.9
    assert G.fit_cm(1000, 100, "footer")[0] == pytest.approx(4.5)


def test_the_exports_keep_a_long_logo_inside_its_box(tmp_path):
    import fitz
    from docx import Document

    path = tmp_path / "wide.png"
    path.write_bytes(picture((3000, 250), (0, 0, 0, 0), [((0, 0, 2999, 249), BLUE)]))
    md = "# Policy\n\nText.\n"
    page = fitz.open(stream=X.export(md, "pdf", title="Policy", entity_name="Bank", logo_path=str(path)), filetype="pdf")[0]
    rect = page.get_image_rects(page.get_images(full=True)[0][0])[0]
    assert rect.width <= 6.0 * 28.3465 + 0.5 and rect.height <= 1.3 * 28.3465 + 0.5
    doc = Document(io.BytesIO(X.export(md, "docx", title="Policy", entity_name="Bank", logo_path=str(path))))
    extent = doc.sections[0].header._element.xpath(".//wp:extent")[0]
    assert int(extent.get("cx")) <= 6.0 * 360000 + 10 and int(extent.get("cy")) <= 1.3 * 360000 + 10
    foot = X.export(md, "docx", title="Policy", logo_path=str(path), logo_position="footer-right")
    extent = Document(io.BytesIO(foot)).sections[0].footer._element.xpath(".//wp:extent")[0]
    assert int(extent.get("cx")) <= 4.5 * 360000 + 10
    assert "max-width:227px" in X.export(md, "html", logo_path=str(path)).decode()


def test_the_upload_answers_with_what_the_gateway_did_and_can_keep_the_original(world):
    r = world.http.post(world.api("/assets"), files={"file": ("mark.svg", SVG, "image/svg+xml")})
    assert r.status_code == 200
    out = r.json()
    assert out["mime"] == "image/png" and {n["code"] for n in out["notes"]} >= {"svg", "trimmed"}
    assert "notes" not in world.http.get(world.api("/assets")).json()["items"][0]                 # only the answer to an upload carries them
    padded = picture((900, 700), WHITE, [((300, 250, 600, 450), BLUE)])
    kept = upload(world, padded, name="Original.png", process="false").json()
    assert (kept["width"], kept["height"]) == (900, 700) and "notes" not in kept
    assert (upload(world, padded, name="Tidied.png").json()["width"]) < 400
    assert world.http.post(world.api("/assets"), files={"file": ("empty.svg", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "image/svg+xml")}).status_code == 400
