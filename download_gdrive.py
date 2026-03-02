import urllib.request
import re
import sys

def download_file_from_google_drive(id, destination):
    URL = "https://docs.google.com/uc?export=download"

    session = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    response = session.open(URL + "&id=" + id)
    
    token = get_confirm_token(response)

    if token:
        params = {"id": id, "confirm": token}
        query_string = urllib.parse.urlencode(params)
        response = session.open(URL + "?" + query_string)

    save_response_content(response, destination)    

def get_confirm_token(response):
    for cookie in response.info().get_all('Set-Cookie', []):
        if re.search(r'download_warning', cookie):
            return re.search(r'download_warning_(\d+)', cookie).group(1)
    return None

def save_response_content(response, destination):
    CHUNK_SIZE = 32768
    with open(destination, "wb") as f:
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            f.write(chunk)

download_file_from_google_drive("11SvcljUmQhaRWbiQpvphuuZFEBnGGUxj", "assets/images/reserva-1.jpg")
download_file_from_google_drive("1DCz5locXa4kzXOZx6ac1XSjtDq_UA13m", "assets/images/reserva-2.jpg")
download_file_from_google_drive("1D_p_dvkl6V4eziX4CmuM9lPOAFLLX4NK", "assets/images/reserva-3.jpg")
