import json

# 模拟 TS 源码字符串里的 \\" → 实际 data 行里是 \"
line = ('data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function",'
        '"function":{"name":"delegate_to_agent","arguments":"{\\"task\\":\\"do x\\",\\"target_character_id\\":\\"char_b\\"}"}}]},'
        '"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}')
print('len:', len(line))
print('pos149:', repr(line[149]))
print('around:', repr(line[120:175]))
try:
    json.loads(line[5:])
    print('JSON OK')
except Exception as e:
    print('JSON FAIL:', e)
