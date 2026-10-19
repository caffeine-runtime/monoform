export namespace app {
	
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

export namespace settings {
	
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

