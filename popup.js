const isImage = (element) => element instanceof HTMLImageElement;

const popupContainer = document.createElement('div');
popupContainer.id = 'popupContainer';
popupContainer.innerHTML = `
  <div id="dropArea">Drop image here to download</div>
`;

// Apply styles for the popup container
popupContainer.style.width = '212px';
popupContainer.style.height = '212px';
popupContainer.style.border = 'none';
popupContainer.style.position = 'fixed';
popupContainer.style.top = '50%';
popupContainer.style.left = '50%';
popupContainer.style.transform = 'translate(-50%, -50%)';
popupContainer.style.display = 'none'; // Initially hide the popup
popupContainer.style.zIndex='99999';
popupContainer.style.background='white'
popupContainer.style.borderRadius="10px"
popupContainer.style.justifyContent="center"
popupContainer.style.alignItems="center";
popupContainer.style.textAlign = 'center';
popupContainer.style.fontWeight="30px"
document.body.appendChild(popupContainer);

document.addEventListener('drag', (event) => {
  event.preventDefault();

  const draggedElement = event.target;
  let isImageElement = false;

  if (isImage(draggedElement)) {
    isImageElement = true;
  } else {
    const childImages = draggedElement.querySelectorAll('img');
    if (childImages.length > 0) {
      isImageElement = true;
    }
  }

  if (isImageElement) {
    popupContainer.style.display = 'flex';
  } else {
    popupContainer.style.display = 'none';
  }
//   console.log("is image:", isImageElement)
});

// document.addEventListener('dragleave', () => {
//   popupContainer.style.display = 'none';
// });
document.addEventListener('dragend', () => {
    popupContainer.style.display = 'none';
  });

popupContainer.addEventListener('dragover', (event) => {
  event.preventDefault();
//  console.log(event.target)
});

popupContainer.addEventListener('drop', (event) => {
    event.preventDefault();
    popupContainer.style.display = 'none';
  
    const draggedElement = event.dataTransfer.getData('text/html');
  
    // Create a temporary element to parse the HTML and extract the image source
    const tempElement = document.createElement('div');
    tempElement.innerHTML = draggedElement;
    const imgElement = tempElement.querySelector('img');
  
    let imgSrc = null;
  
    if (imgElement) {
      if (imgElement.srcset) {
        // If srcset attribute is present, choose the last image in the list
        const sources = imgElement.srcset.split(',');
        const lastSource = sources[sources.length - 1].trim().split(' ')[0];
        imgSrc = lastSource;
      } else if (imgElement.src) {
        // If src attribute is present, use that
        imgSrc = imgElement.src;
      }
    }
  
    if (imgSrc) {
        if (!imgSrc.startsWith("http")) {
            imgSrc = "https:"+imgSrc
          }
   
       try{
        const filename = extractFilenameFromURL(imgSrc);
        console.log(`URL: ${imgSrc} => Filename: ${filename}`);
       }
       catch(error){
        getFilenameFromURL(imgSrc)
    .then((filename) => {console.log(`URL: ${imgSrc} => Filename: ${filename}`);})
       
       }
    
      // Trigger the download
      chrome.runtime.sendMessage({ action: 'downloadImage', imgSrc });
    //   chrome.downloads.download(downloadOptions);
    } else {
      console.log('No image found.');
    }
  });
  
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'hug'){

        console.log("Message received in the popup script:", message);
    }
    
  });

  function getFilenameFromURL(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("HEAD", url, true);
  
      xhr.onreadystatechange = function () {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          if (xhr.status === 200) {
            const contentDisposition = xhr.getResponseHeader("Content-Disposition");
            if (contentDisposition) {
              const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
              if (filenameMatch && filenameMatch[1]) {
                const filename = filenameMatch[1].replace(/['"]/g, '');
                resolve(filename);
              } else {
                reject("Could not extract filename from Content-Disposition header.");
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

  

  function extractFilenameFromURL(url) {
    let filename;
  
    if (url.startsWith("data:image/jpeg;base64")) {
      filename = "download.jpg";
    } else {
      // Extract the "url" query parameter
    //   const imageUrl = new URL(url).searchParams.get("url");
      
      // Parse the extracted URL
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const segments = pathname.split('/');
      filename = segments[segments.length - 1];
      
      // Check if the filename is empty or undefined
      if (!filename) {
        // Extract the filename using decodeURIComponent
        const imageUrl = new URL(url).searchParams.get("url");
        const parsedUrl = new URL(imageUrl);

        filename = decodeURIComponent(parsedUrl.pathname).split('/').pop();
      }
      
      // Check if the filename has an extension
      if (!filename.includes('.')) {
        filename += '.jpg';  // Add ".jpg" as the default extension
      }
    }
    
    return filename;
  }
  
  
  
  
  

  
  
  
