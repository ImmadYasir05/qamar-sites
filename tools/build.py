"""Convert a Design canvas artboard (.dc.html) into a standalone static page.

Usage: python3 build.py <src.dc.html> <out_dir> <form_name>
"""
import re, sys, pathlib

src, out_dir, form_name = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
html = pathlib.Path(src).read_text()

title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
xdc = re.search(r"<x-dc>(.*)</x-dc>", html, re.S).group(1)
helmet = re.search(r"<helmet>(.*?)</helmet>", xdc, re.S).group(1)
body_tpl = re.sub(r"<helmet>.*?</helmet>", "", xdc, flags=re.S).strip()
logic = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', html, re.S).group(1)

blob = re.compile(r"/_blob/([0-9a-f]{32})")
body_tpl = blob.sub(r"images/\1.jpg", body_tpl)
logic = blob.sub(r"images/\1.jpg", logic)
helmet = blob.sub(r"images/\1.jpg", helmet)

# Fields a static Netlify form needs so the service detects the form at deploy.
input_names = sorted(set(re.findall(r'<(?:input|textarea)[^>]*name="([^"]+)"', body_tpl)))
extra = ["date", "looking_for", "bridesmaids", "on_the_day"]
detect = "\n".join(f'  <input name="{n}">' if n != "message" else '  <textarea name="message"></textarea>'
                   for n in input_names + extra)

morphdom = pathlib.Path("node_modules/morphdom/dist/morphdom-umd.min.js").read_text()
extras = pathlib.Path(sys.argv[4]).read_text() if len(sys.argv) > 4 else ""
runtime = pathlib.Path("runtime.js").read_text().replace("__FORM_NAME__", form_name)

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{title}">
<link rel="icon" href="images/{blob.search(html).group(1) if False else ''}">
{helmet.strip()}
</head>
<body>
<form name="{form_name}" data-netlify="true" netlify-honeypot="bot-field" hidden>
  <input name="bot-field">
{detect}
</form>
<div id="dc-root"></div>
<template id="dc-tpl">
{body_tpl}
</template>
<noscript><p style="padding:24px">Please enable JavaScript to view this site.</p></noscript>
<script>{morphdom}</script>
<script>
{runtime}
</script>
<script>
{logic.strip()}
</script>
<script>
{extras}
</script>
<script>DC.mount(Component);</script>
</body>
</html>
"""
# Logo as favicon: the round loader image.
logo = re.search(r'class="curtain".*?<img src="images/([0-9a-f]{32})\.jpg"', page, re.S)
page = page.replace('<link rel="icon" href="images/">',
                    f'<link rel="icon" href="images/{logo.group(1)}.jpg">' if logo else "")

out_dir.mkdir(parents=True, exist_ok=True)
(out_dir / "index.html").write_text(page)
print("wrote", out_dir / "index.html", len(page), "bytes; form fields:", input_names + extra)
