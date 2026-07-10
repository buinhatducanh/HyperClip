const { Innertube } = require('youtubei.js');

(async () => {
  try {
    const yt = await Innertube.create({ retrieve_player: false });
    const playlistId = 'UUE-PEoUbxALoKIJ2AoSyeqA';
    const playlist = await yt.getPlaylist(playlistId);
    console.log('playlist.page keys:', Object.keys(playlist.page || {}));
    if (playlist.page) {
      console.log('contents:', JSON.stringify(playlist.page.contents || {}).substring(0, 1000));
    }
  } catch (e) {
    console.error('Error:', e);
  }
})();
