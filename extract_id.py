import re
try:
    content = open('channel_page.html', 'r', encoding='utf-8').read()
    m = re.search(r'"externalId":"(UC[^"]+)"', content)
    print(f"externalId: {m.group(1)}" if m else "externalId not found")
    # Also check for meta property="og:url"
    m2 = re.search(r'meta property="og:url" content="https://www.youtube.com/channel/(UC[^"]+)"', content)
    print(f"og:url: {m2.group(1)}" if m2 else "og:url not found")
except Exception as e:
    print(e)
