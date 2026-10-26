// MV Clipboard Bridge — GNOME Shell 45+ (ESM).
// Por que existe: o Mutter (GNOME) não expõe o protocolo data-control do Wayland, então nenhum app comum
// consegue monitorar o clipboard em segundo plano. Dentro do Shell dá: Meta.Selection avisa toda mudança.
// Comunicação com o app (sem D-Bus, só arquivos atômicos em $XDG_RUNTIME_DIR/mv-clipboard):
//   extensão -> app : inbox/<ms>-<id>.json   {"type":"clip","kind":"text|image","mime":"...","b64":"..."}
//   app -> extensão : shell/<ms>-<id>.json   {"type":"paste","shift":false}
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MAX_TEXT = 1_000_000;
const MAX_IMAGE = 12_000_000;
const SENSITIVE = ['x-kde-passwordmanagerhint'];
const TERMINALS = ['gnome-terminal', 'terminal', 'console', 'kitty', 'alacritty', 'konsole', 'tilix', 'xterm',
    'terminator', 'wezterm', 'foot', 'ptyxis', 'guake', 'yakuake', 'urxvt'];

export default class MvClipboardBridge extends Extension {
    enable() {
        this._root = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'mv-clipboard']);
        this._inbox = GLib.build_filenamev([this._root, 'inbox']);
        this._shellDir = GLib.build_filenamev([this._root, 'shell']);
        GLib.mkdir_with_parents(this._inbox, 0o700);
        GLib.mkdir_with_parents(this._shellDir, 0o700);

        this._clipboard = St.Clipboard.get_default();
        this._readTimer = 0;

        // 1) Mudanças no clipboard
        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect('owner-changed', (_sel, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._scheduleRead();
        });

        // 2) Pedidos do app (colar)
        this._monitor = Gio.File.new_for_path(this._shellDir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitorId = this._monitor.connect('changed', () => this._scanShellDir());
        this._scanShellDir();

        // 3) Batimento: o app só usa a ponte se isto estiver fresco
        this._beat();
        this._heartbeat = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._beat();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._ownerChangedId) this._selection.disconnect(this._ownerChangedId);
        if (this._monitorId) this._monitor.disconnect(this._monitorId);
        this._monitor?.cancel();
        if (this._readTimer) GLib.source_remove(this._readTimer);
        if (this._heartbeat) GLib.source_remove(this._heartbeat);
        try {
            Gio.File.new_for_path(GLib.build_filenamev([this._root, 'shell.alive'])).delete(null);
        } catch (e) { /* já removido */ }
        this._ownerChangedId = this._monitorId = this._readTimer = this._heartbeat = 0;
        this._selection = this._monitor = this._clipboard = this._kbd = null;
    }

    _beat() {
        try {
            Gio.File.new_for_path(GLib.build_filenamev([this._root, 'shell.alive']))
                .replace_contents(String(Date.now()), null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) { logError(e, 'mv-clipboard: batimento'); }
    }

    _appAlive() {
        try {
            const info = Gio.File.new_for_path(GLib.build_filenamev([this._root, 'app.alive']))
                .query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
            return (GLib.get_real_time() / 1000000) - info.get_modification_date_time().to_unix() < 15;
        } catch (e) { return false; }
    }

    // ---- captura ----
    _scheduleRead() {
        if (this._readTimer) GLib.source_remove(this._readTimer);
        // pequena espera: o dono do clipboard ainda está publicando os formatos
        this._readTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._readTimer = 0;
            if (this._appAlive()) this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    _read() {
        const types = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
        if (types.some(t => SENSITIVE.includes(t.toLowerCase()))) return;

        const hasText = types.some(t => t.startsWith('text/plain') || t === 'UTF8_STRING' || t === 'STRING');
        if (hasText) {
            this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => {
                if (!text) return;
                const bytes = new TextEncoder().encode(text);
                if (bytes.length <= MAX_TEXT) this._post('text', 'text/plain', bytes);
            });
        } else if (types.includes('image/png')) {
            this._clipboard.get_content(St.ClipboardType.CLIPBOARD, 'image/png', (_c, bytes) => {
                const data = bytes?.get_data();
                if (data && data.length > 0 && data.length <= MAX_IMAGE) this._post('image', 'image/png', data);
            });
        }
    }

    _post(kind, mime, data) {
        const base = `${Date.now()}-${GLib.random_int_range(0, 1 << 30).toString(16)}`;
        const tmp = Gio.File.new_for_path(GLib.build_filenamev([this._inbox, `${base}.tmp`]));
        const dst = Gio.File.new_for_path(GLib.build_filenamev([this._inbox, `${base}.json`]));
        const payload = new GLib.Bytes(new TextEncoder().encode(
            JSON.stringify({type: 'clip', kind, mime, b64: GLib.base64_encode(data)})));
        tmp.replace_contents_bytes_async(payload, null, false, Gio.FileCreateFlags.NONE, null, (file, res) => {
            try {
                file.replace_contents_finish(res);
                tmp.move(dst, Gio.FileCopyFlags.OVERWRITE, null, null); // publica de forma atômica
            } catch (e) { logError(e, 'mv-clipboard: gravar item'); }
        });
    }

    // ---- colar ----
    _scanShellDir() {
        const dir = Gio.File.new_for_path(this._shellDir);
        let en;
        try { en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null); } catch (e) { return; }
        let info;
        while ((info = en.next_file(null)) !== null) {
            const name = info.get_name();
            if (!name.endsWith('.json')) continue;
            const file = dir.get_child(name);
            try {
                const [ok, contents] = file.load_contents(null);
                file.delete(null);
                if (ok) this._handle(JSON.parse(new TextDecoder().decode(contents)));
            } catch (e) { logError(e, 'mv-clipboard: mensagem do app'); }
        }
        en.close(null);
    }

    _handle(msg) {
        if (msg?.type === 'paste') this._paste(msg.shift === true);
    }

    _paste(forceShift) {
        const cls = (global.display.focus_window?.get_wm_class() ?? '').toLowerCase();
        const shift = forceShift || TERMINALS.some(t => cls.includes(t)); // terminais: Ctrl+Shift+V
        this._kbd ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const t = () => GLib.get_monotonic_time();
        const press = k => this._kbd.notify_keyval(t(), k, Clutter.KeyState.PRESSED);
        const release = k => this._kbd.notify_keyval(t(), k, Clutter.KeyState.RELEASED);
        press(Clutter.KEY_Control_L);
        if (shift) press(Clutter.KEY_Shift_L);
        press(Clutter.KEY_v);
        release(Clutter.KEY_v);
        if (shift) release(Clutter.KEY_Shift_L);
        release(Clutter.KEY_Control_L);
    }
}
