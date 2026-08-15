import urllib.request
import sys

url = 'https://teelbloc-coding-test.vercel.app/api/llm/solve?level=level1&name=2%20Obstacle'
req = urllib.request.Request(url)
try:
    with urllib.request.urlopen(req) as response:
        print('STATUS:', response.status)
        print('HEADERS:', response.headers)
        for i, line in enumerate(response):
            print(line.decode('utf-8').strip())
            if i > 5:
                break
except urllib.error.HTTPError as e:
    print('HTTP ERROR:', e.code, e.reason)
    print(e.read().decode('utf-8'))
except Exception as e:
    import traceback
    traceback.print_exc()
