chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "downloadImage") {
    const { imgSrc } = message;

    filename = null;
    try {
      filename = extractFilenameFromURL(imgSrc);
      console.log(`URL: ${imgSrc} => Filename: ${filename}`);
    } catch (error) {
      getFilenameFromURL(imgSrc).then((filename) => {
        filename = filename;
        if (!filename.includes(".")) {
          filename += ".jpg"; // Add ".jpg" as the default extension
        }
        console.log(`URL: ${imgSrc} => Filename: ${filename}`);
      });
      // const filename =  getFilenameFromURL(imgSrc)
    }
    chrome.downloads.download({
      url: imgSrc,
      filename: "file/" + filename,
      saveAs: false,
    });
  }
});

function extractFilenameFromURL(url) {
  if (url.startsWith("data:image/jpeg;base64")) {
    return "download.jpg";
  }

  const parsedUrl = new URL(url);
  const pathname = parsedUrl.pathname;
  const segments = pathname.split("/");
  let filename = segments[segments.length - 1];
  if (!filename) {
    // Extract the filename using decodeURIComponent
    const imageUrl = new URL(url).searchParams.get("url");
    const parsedUrl = new URL(imageUrl);

    filename = decodeURIComponent(parsedUrl.pathname).split("/").pop();
  }
  if (!filename.includes(".")) {
    filename += ".jpg"; // Add ".jpg" as the default extension
  }
  return filename;
}

function getFilenameFromURL(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("HEAD", url, true);

    xhr.onreadystatechange = function () {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status === 200) {
          const contentDisposition = xhr.getResponseHeader(
            "Content-Disposition"
          );
          if (contentDisposition) {
            const filenameMatch = contentDisposition.match(
              /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
            );
            if (filenameMatch && filenameMatch[1]) {
              const filename = filenameMatch[1].replace(/['"]/g, "");
              resolve(filename);
            } else {
              reject(
                "Could not extract filename from Content-Disposition header."
              );
            }
          } else {
            // If Content-Disposition header is not present, extract filename from URL
            const urlParts = url.split("/");
            const filename = urlParts[urlParts.length - 1];
            resolve(filename);
          }
        } else {
          reject("Failed to retrieve headers.");
        }
      }
    };

    xhr.send();
  });
}
