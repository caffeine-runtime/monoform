export namespace app {
	
	export class AudioOpened {
	    id: string;
	    info?: audio.Info;
	    url: string;
	    lanes: number;
	
	    static createFrom(source: any = {}) {
	        return new AudioOpened(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.info = this.convertValues(source["info"], audio.Info);
	        this.url = source["url"];
	        this.lanes = source["lanes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BootInfo {
	    token: string;
	    settings: settings.Settings;
	    platform: string;
	    version: string;
	    launchFiles: string[];
	    home: string;
	    pathSep: string;
	    testScript: string;
	    testArg: string;
	
	    static createFrom(source: any = {}) {
	        return new BootInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.settings = this.convertValues(source["settings"], settings.Settings);
	        this.platform = source["platform"];
	        this.version = source["version"];
	        this.launchFiles = source["launchFiles"];
	        this.home = source["home"];
	        this.pathSep = source["pathSep"];
	        this.testScript = source["testScript"];
	        this.testArg = source["testArg"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DocOpenResult {
	    document: string;
	    styles: Record<string, string>;
	    rels: office.Relationship[];
	    saveAs: string;
	    note: string;
	    template: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DocOpenResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.document = source["document"];
	        this.styles = source["styles"];
	        this.rels = this.convertValues(source["rels"], office.Relationship);
	        this.saveAs = source["saveAs"];
	        this.note = source["note"];
	        this.template = source["template"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileFilter {
	    name: string;
	    patterns: string;
	
	    static createFrom(source: any = {}) {
	        return new FileFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.patterns = source["patterns"];
	    }
	}
	export class Locations {
	    settings: string;
	    cache: string;
	
	    static createFrom(source: any = {}) {
	        return new Locations(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.settings = source["settings"];
	        this.cache = source["cache"];
	    }
	}
	export class PassagesResult {
	    size: number;
	    mod: number;
	    passages: semantic.Passage[];
	
	    static createFrom(source: any = {}) {
	        return new PassagesResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.size = source["size"];
	        this.mod = source["mod"];
	        this.passages = this.convertValues(source["passages"], semantic.Passage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SemanticInfo {
	    installed: boolean;
	    modelId: string;
	    repo: string;
	    revision: string;
	    license: string;
	    modelBytes: number;
	    dims: number;
	    modelDir: string;
	
	    static createFrom(source: any = {}) {
	        return new SemanticInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.installed = source["installed"];
	        this.modelId = source["modelId"];
	        this.repo = source["repo"];
	        this.revision = source["revision"];
	        this.license = source["license"];
	        this.modelBytes = source["modelBytes"];
	        this.dims = source["dims"];
	        this.modelDir = source["modelDir"];
	    }
	}

}

export namespace archive {
	
	export class Entry {
	    name: string;
	    size: number;
	    modTime: number;
	    isDir: boolean;
	    link?: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.isDir = source["isDir"];
	        this.link = source["link"];
	    }
	}
	export class Info {
	    format: string;
	    writable: boolean;
	    entries: Entry[];
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.writable = source["writable"];
	        this.entries = this.convertValues(source["entries"], Entry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Limits {
	    maxEntries: number;
	    maxBytes: number;
	    maxRatio: number;
	    ratioFloor: number;
	
	    static createFrom(source: any = {}) {
	        return new Limits(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.maxEntries = source["maxEntries"];
	        this.maxBytes = source["maxBytes"];
	        this.maxRatio = source["maxRatio"];
	        this.ratioFloor = source["ratioFloor"];
	    }
	}
	export class Options {
	    entries: string[];
	    existing: string;
	    limits: Limits;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = source["entries"];
	        this.existing = source["existing"];
	        this.limits = this.convertValues(source["limits"], Limits);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace audio {
	
	export class ExportOptions {
	    format: string;
	    bitDepth: number;
	
	    static createFrom(source: any = {}) {
	        return new ExportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.bitDepth = source["bitDepth"];
	    }
	}
	export class Info {
	    codec: string;
	    editable: boolean;
	    reason?: string;
	    sampleRate: number;
	    channels: number;
	    bitDepth: number;
	    float: boolean;
	    frames: number;
	    duration: number;
	    bitrate: number;
	    lossless: boolean;
	    tags: Record<string, string>;
	    hasCover: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.codec = source["codec"];
	        this.editable = source["editable"];
	        this.reason = source["reason"];
	        this.sampleRate = source["sampleRate"];
	        this.channels = source["channels"];
	        this.bitDepth = source["bitDepth"];
	        this.float = source["float"];
	        this.frames = source["frames"];
	        this.duration = source["duration"];
	        this.bitrate = source["bitrate"];
	        this.lossless = source["lossless"];
	        this.tags = source["tags"];
	        this.hasCover = source["hasCover"];
	    }
	}
	export class Ramp {
	    g0: number;
	    g1: number;
	
	    static createFrom(source: any = {}) {
	        return new Ramp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.g0 = source["g0"];
	        this.g1 = source["g1"];
	    }
	}
	export class Segment {
	    start: number;
	    end: number;
	    silence?: boolean;
	    gains?: Ramp[];
	
	    static createFrom(source: any = {}) {
	        return new Segment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.silence = source["silence"];
	        this.gains = this.convertValues(source["gains"], Ramp);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace filetype {
	
	export class Info {
	    kind: string;
	    mime: string;
	    ext: string;
	    byMagic: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.mime = source["mime"];
	        this.ext = source["ext"];
	        this.byMagic = source["byMagic"];
	    }
	}

}

export namespace fs {
	
	export class Entry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    modTime: number;
	    kind: string;
	    hidden: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.kind = source["kind"];
	        this.hidden = source["hidden"];
	    }
	}

}

export namespace newfile {
	
	export class Options {
	    width: number;
	    height: number;
	    background: string;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	        this.background = source["background"];
	    }
	}

}

export namespace office {
	
	export class SheetInfo {
	    name: string;
	    rows: number;
	    cols: number;
	
	    static createFrom(source: any = {}) {
	        return new SheetInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.rows = source["rows"];
	        this.cols = source["cols"];
	    }
	}
	export class BookInfo {
	    id: string;
	    format: string;
	    sheets: SheetInfo[];
	    saveAs: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new BookInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.format = source["format"];
	        this.sheets = this.convertValues(source["sheets"], SheetInfo);
	        this.saveAs = source["saveAs"];
	        this.note = source["note"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CellInfo {
	    value: string;
	    formula: string;
	    input: string;
	
	    static createFrom(source: any = {}) {
	        return new CellInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.formula = source["formula"];
	        this.input = source["input"];
	    }
	}
	export class Relationship {
	    id: string;
	    type: string;
	    target: string;
	    external: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Relationship(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.target = source["target"];
	        this.external = source["external"];
	    }
	}

}

export namespace pdf {
	
	export class Op {
	    kind: string;
	    pages: number[];
	    degrees: number;
	    order: number[];
	    others: string[];
	
	    static createFrom(source: any = {}) {
	        return new Op(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.pages = source["pages"];
	        this.degrees = source["degrees"];
	        this.order = source["order"];
	        this.others = source["others"];
	    }
	}

}

export namespace search {
	
	export class Options {
	    query: string;
	    caseSensitive: boolean;
	    wholeWord: boolean;
	    regex: boolean;
	    showHidden: boolean;
	    maxResults: number;
	    maxFileSize: number;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.caseSensitive = source["caseSensitive"];
	        this.wholeWord = source["wholeWord"];
	        this.regex = source["regex"];
	        this.showHidden = source["showHidden"];
	        this.maxResults = source["maxResults"];
	        this.maxFileSize = source["maxFileSize"];
	    }
	}

}

export namespace semantic {
	
	export class Hit {
	    path: string;
	    line: number;
	    score: number;
	    snippet: string;
	
	    static createFrom(source: any = {}) {
	        return new Hit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.line = source["line"];
	        this.score = source["score"];
	        this.snippet = source["snippet"];
	    }
	}
	export class Item {
	    line: number;
	    text: string;
	    vector: number[];
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.line = source["line"];
	        this.text = source["text"];
	        this.vector = source["vector"];
	    }
	}
	export class Passage {
	    line: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Passage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.line = source["line"];
	        this.text = source["text"];
	    }
	}
	export class PendingFile {
	    path: string;
	    size: number;
	    partial: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PendingFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.size = source["size"];
	        this.partial = source["partial"];
	    }
	}
	export class Pending {
	    files: PendingFile[];
	    total: number;
	    indexed: number;
	    passages: number;
	
	    static createFrom(source: any = {}) {
	        return new Pending(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], PendingFile);
	        this.total = source["total"];
	        this.indexed = source["indexed"];
	        this.passages = source["passages"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Status {
	    files: number;
	    passages: number;
	    bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = source["files"];
	        this.passages = source["passages"];
	        this.bytes = source["bytes"];
	    }
	}

}

export namespace server {
	
	export class AssetResult {
	    path: string;
	    rel: string;
	
	    static createFrom(source: any = {}) {
	        return new AssetResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.rel = source["rel"];
	    }
	}

}

export namespace settings {
	
	export class Semantic {
	    enabled: boolean;
	    unloadAfter: number;
	
	    static createFrom(source: any = {}) {
	        return new Semantic(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.unloadAfter = source["unloadAfter"];
	    }
	}
	export class SessionTab {
	    kind: string;
	    path?: string;
	    entry?: string;
	    tool?: string;
	    module?: string;
	    state?: string;
	    pinned?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SessionTab(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.path = source["path"];
	        this.entry = source["entry"];
	        this.tool = source["tool"];
	        this.module = source["module"];
	        this.state = source["state"];
	        this.pinned = source["pinned"];
	    }
	}
	export class Session {
	    folder: string;
	    tabs: SessionTab[];
	    active: number;
	    expanded: string[];
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folder = source["folder"];
	        this.tabs = this.convertValues(source["tabs"], SessionTab);
	        this.active = source["active"];
	        this.expanded = source["expanded"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Settings {
	    version: number;
	    theme: string;
	    recents: string[];
	    recentFolders: string[];
	    pinned: string[];
	    sidebarVisible: boolean;
	    sidebarWidth: number;
	    showHidden: boolean;
	    wordWrap: boolean;
	    fontSize: number;
	    session: Session;
	    semantic: Semantic;
	    recentsOff: boolean;
	    imageKeepOriginal: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.theme = source["theme"];
	        this.recents = source["recents"];
	        this.recentFolders = source["recentFolders"];
	        this.pinned = source["pinned"];
	        this.sidebarVisible = source["sidebarVisible"];
	        this.sidebarWidth = source["sidebarWidth"];
	        this.showHidden = source["showHidden"];
	        this.wordWrap = source["wordWrap"];
	        this.fontSize = source["fontSize"];
	        this.session = this.convertValues(source["session"], Session);
	        this.semantic = this.convertValues(source["semantic"], Semantic);
	        this.recentsOff = source["recentsOff"];
	        this.imageKeepOriginal = source["imageKeepOriginal"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

