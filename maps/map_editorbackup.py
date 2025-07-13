import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, scrolledtext
from PIL import Image, ImageTk
import json
import math
import traceback
import sys

print("Démarrage du Map Editor...")

class MapEditor:
    def __init__(self, root):
        print("Initialisation de MapEditor...")
        
        self.root = root
        self.root.title("Map Editor - Professional Edition")

        # Frame principal horizontal
        main_container = tk.Frame(root)
        main_container.pack(fill=tk.BOTH, expand=True)
        
        # Frame gauche pour le canvas
        left_frame = tk.Frame(main_container)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH)
        
        # Canvas - NOUVELLE RÉSOLUTION
        self.canvas = tk.Canvas(left_frame, width=1536, height=1024, bg="black")
        self.canvas.pack()

        # Frame droite pour les contrôles et infos
        right_frame = tk.Frame(main_container, bg="gray20", width=300)
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)
        right_frame.pack_propagate(False)  # Empêcher le redimensionnement automatique

        self.background_image = None
        self.background_path = None
        self.background_key = "assets/background.png"  # Clé par défaut mise à jour
        self.music_key = "assets/audio/theme.mp3"  # Musique par défaut
        self.map_name = "custom_track"  # Nom par défaut
        self.map_id = "custom_track"  # ID par défaut
        
        # Paramètres de course
        self.race_settings = {
            "laps": 3,
            "maxTime": 300000,
            "maxTimeWarning": 240000
        }

        self.mode = "wall"  # wall, curve, finish, checkpoint, edit, modify_curve, spawnpoint, spawnpoint_horizontal, booster, item, continuous_curve, racing_line, void_zone, road
        self.current_curve = []
        self.current_continuous_curve = []  # Pour les courbes continues
        self.current_void_zone = []  # Pour les zones de vide en cours
        self.is_drawing_continuous = False
        self.is_drawing_void_zone = False
        self.is_drawing_racing_line = False  # Pour la ligne de course
        self.current_racing_line = []  # Points de la ligne de course en cours
        self.rectangles = []
        self.curves = []
        self.continuous_curves = []  # Nouveau : pour stocker les courbes continues comme un seul objet
        self.void_zones = []  # Pour stocker les zones de vide (chute)
        self.checkpoints = []  # Maintenant des lignes
        self.spawnpoints = []
        self.boosters = []  # Maintenant des lignes
        self.items = []  # Maintenant des lignes
        self.finish_line = None  # Maintenant une ligne
        self.racing_line = None  # Ligne de course pour le calcul des positions
        self.actions_stack = []
        
        # Road drawing (Blender-style)
        self.road_mesh = []  # List of connected road vertices
        self.road_edges = []  # List of edges (pairs of vertex indices)
        self.road_faces = []  # List of road segments (quads defined by 4 vertex indices)
        self.selected_vertices = []  # Currently selected vertices
        self.road_edit_mode = None  # 'extrude', 'scale', 'rotate', 'grab'
        self.road_width = 80  # Default road width
        self.is_drawing_road = False
        self.extrude_preview = None  # Preview data for extrusion
        self.mouse_pos = (0, 0)  # Track mouse position

        self.selected_object = None
        
        # Variables pour le mode édition type Blender
        self.edit_mode = None  # None, 'grab', 'resize', 'rotate'
        self.edit_start_pos = None
        self.edit_original_state = None
        self.mouse_pos = (0, 0)
        self.resize_handle = None  # Pour savoir quelle poignée est utilisée
        
        # Variables pour dessiner les lignes
        self.drawing_line = False
        self.line_start = None

        self.init_ui(right_frame)
        self.bind_events()
        
        # Afficher les infos en bas du panneau droit
        self.info_label = tk.Label(right_frame, text="", bg="gray30", fg="white", padx=10, pady=5, wraplength=280)
        self.info_label.pack(fill=tk.X, pady=(10, 0))
        
        # Zone de log dans le panneau droit
        self.log_frame = tk.Frame(right_frame, bg="gray20")
        self.log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        tk.Label(self.log_frame, text="Console Log:", bg="gray20", fg="white", font=("Arial", 10, "bold")).pack(fill=tk.X)
        
        self.log_text = scrolledtext.ScrolledText(self.log_frame, height=15, bg="black", fg="lime", 
                                                   font=("Consolas", 9), wrap=tk.WORD)
        self.log_text.pack(fill=tk.BOTH, expand=True)
        
        self.log("Map Editor démarré avec succès - Résolution 1536x1024")
        self.update_info()
        
        print("MapEditor initialisé avec succès")
    
    def log(self, message):
        """Ajouter un message au log"""
        try:
            self.log_text.insert(tk.END, f"[LOG] {message}\n")
            self.log_text.see(tk.END)
            self.log_text.update()
        except:
            print(f"[LOG] {message}")

    def init_ui(self, parent_frame):
        # Titre
        title_label = tk.Label(parent_frame, text="MAP EDITOR", bg="gray20", fg="white", 
                              font=("Arial", 14, "bold"))
        title_label.pack(pady=10)
        
        # Section Fichiers
        section_frame = tk.LabelFrame(parent_frame, text="FICHIERS", bg="gray20", fg="white", 
                                     font=("Arial", 10, "bold"))
        section_frame.pack(fill=tk.X, padx=10, pady=5)
        
        tk.Button(section_frame, text="📁 Charger image", command=self.load_image, 
                 bg="#3498db", fg="white", width=20).pack(pady=2)
        tk.Button(section_frame, text="📄 Importer JSON", command=self.import_json, 
                 bg="#3498db", fg="white", width=20).pack(pady=2)
        tk.Button(section_frame, text="💾 Exporter JSON", command=self.export_json, 
                 bg="#2ecc71", fg="white", width=20).pack(pady=2)
        tk.Button(section_frame, text="⚙️ Paramètres map", command=self.map_settings, 
                 bg="#95a5a6", fg="white", width=20).pack(pady=2)
        
        # Section Outils de création
        creation_frame = tk.LabelFrame(parent_frame, text="CRÉATION", bg="gray20", fg="white",
                                      font=("Arial", 10, "bold"))
        creation_frame.pack(fill=tk.X, padx=10, pady=5)
        
        tk.Button(creation_frame, text="🧱 Mur", command=lambda: self.set_mode("wall"), 
                 bg="#e74c3c", fg="white", width=20).pack(pady=2)
        tk.Button(creation_frame, text="🌊 Mur courbe", command=lambda: self.set_mode("curve"), 
                 bg="#e67e22", fg="white", width=20).pack(pady=2)
        tk.Button(creation_frame, text="〰️ Courbe continue", command=lambda: self.set_mode("continuous_curve"), 
                 bg="#d35400", fg="white", width=20).pack(pady=2)
        tk.Button(creation_frame, text="📍 Checkpoint", command=lambda: self.set_mode("checkpoint"), 
                 bg="#27ae60", fg="white", width=20).pack(pady=2)
        tk.Button(creation_frame, text="🏁 Ligne arrivée", command=lambda: self.set_mode("finish"), 
                 bg="#ecf0f1", fg="black", width=20).pack(pady=2)
        
        # Section Objets spéciaux
        objects_frame = tk.LabelFrame(parent_frame, text="OBJETS", bg="gray20", fg="white",
                                     font=("Arial", 10, "bold"))
        objects_frame.pack(fill=tk.X, padx=10, pady=5)
        
        tk.Button(objects_frame, text="🚗 Spawn V (2x3)", command=lambda: self.set_mode("spawnpoint"), 
                 bg="#9b59b6", fg="white", width=20).pack(pady=2)
        tk.Button(objects_frame, text="🚗 Spawn H (3x2)", command=lambda: self.set_mode("spawnpoint_horizontal"), 
                 bg="#8e44ad", fg="white", width=20).pack(pady=2)
        tk.Button(objects_frame, text="⚡ Booster", command=lambda: self.set_mode("booster"), 
                 bg="#f39c12", fg="white", width=20).pack(pady=2)
        tk.Button(objects_frame, text="🎁 Item", command=lambda: self.set_mode("item"), 
                 bg="#1abc9c", fg="white", width=20).pack(pady=2)
        tk.Button(objects_frame, text="🏎️ Ligne de course", command=lambda: self.set_mode("racing_line"), 
                 bg="#e74c3c", fg="white", width=20).pack(pady=2)
        tk.Button(objects_frame, text="☠️ Zone de vide", command=lambda: self.set_mode("void_zone"), 
                 bg="#ff6b35", fg="white", width=20).pack(pady=2)
        tk.Button(objects_frame, text="🛣️ Route (Blender)", command=lambda: self.set_mode("road"), 
                 bg="#8e44ad", fg="white", width=20).pack(pady=2)
        
        # Section Édition
        edit_frame = tk.LabelFrame(parent_frame, text="ÉDITION", bg="gray20", fg="white",
                                  font=("Arial", 10, "bold"))
        edit_frame.pack(fill=tk.X, padx=10, pady=5)
        
        tk.Button(edit_frame, text="✏️ Mode édition", command=lambda: self.set_mode("edit"), 
                 bg="#34495e", fg="white", width=20).pack(pady=2)
        tk.Button(edit_frame, text="🔧 Modifier courbe", command=lambda: self.set_mode("modify_curve"), 
                 bg="#34495e", fg="white", width=20).pack(pady=2)
        tk.Button(edit_frame, text="↩️ Annuler (Ctrl+Z)", command=self.undo, 
                 bg="#95a5a6", fg="white", width=20).pack(pady=2)
        tk.Button(edit_frame, text="🗑️ Tout effacer", command=self.clear_all, 
                 bg="#c0392b", fg="white", width=20).pack(pady=2)

    def bind_events(self):
        self.canvas.bind("<Button-1>", self.on_click)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.canvas.bind("<Motion>", self.on_motion)
        self.canvas.bind("<Button-3>", self.on_right_click)
        
        # Raccourcis clavier pour le mode édition
        self.root.bind("<g>", lambda e: self.start_edit_operation('grab') if self.mode == "edit" else None)
        self.root.bind("<r>", lambda e: self.start_edit_operation('rotate') if self.mode == "edit" else None)
        self.root.bind("<Escape>", lambda e: self.cancel_edit_operation() if self.edit_mode else (self.stop_continuous_curve() if self.is_drawing_continuous else (self.stop_void_zone() if self.is_drawing_void_zone else (self.stop_racing_line() if self.is_drawing_racing_line else self.cancel_road_operation()))))
        self.root.bind("<Return>", lambda e: self.confirm_edit_operation() if self.edit_mode else (self.stop_continuous_curve() if self.is_drawing_continuous else (self.stop_racing_line() if self.is_drawing_racing_line else None)))
        
        # Road mode specific bindings (Blender-style)
        self.root.bind("<e>", lambda e: self.start_road_extrude() if self.mode == "road" and self.selected_vertices else None)
        self.root.bind("<g>", lambda e: (self.start_edit_operation('grab') if self.mode == "edit" else self.start_road_grab() if self.mode == "road" and self.selected_vertices else None))
        self.root.bind("<s>", lambda e: self.start_road_scale() if self.mode == "road" and self.selected_vertices else None)
        self.root.bind("<r>", lambda e: (self.start_edit_operation('rotate') if self.mode == "edit" else self.start_road_rotate() if self.mode == "road" and self.selected_vertices else None))
        self.root.bind("<c>", lambda e: self.start_road_curve() if self.mode == "road" and len(self.selected_vertices) >= 2 else None)
        self.root.bind("<Control-z>", lambda e: self.undo_last_action())
        self.root.bind("<Delete>", lambda e: self.delete_selected())
        self.root.bind("<Control-z>", lambda e: self.undo())

    def update_info(self):
        info = f"Mode: {self.mode}\nRésolution: 1536x1024"
        if self.mode == "edit":
            if self.edit_mode:
                info += f"\nOpération: {self.edit_mode}\n(Clic gauche/Enter pour valider, Echap pour annuler)"
            else:
                info += "\nG: Déplacer, R: Tourner\nDel: Supprimer\nTirer les poignées pour redimensionner"
        elif self.mode == "curve":
            info += f"\nPoints: {len(self.current_curve)}/3"
        elif self.mode == "continuous_curve":
            if self.is_drawing_continuous:
                info += f"\nCliquez pour ajouter des points\nEnter/Echap pour terminer"
            else:
                info += f"\nCliquez pour commencer une nouvelle courbe continue"
        elif self.mode in ["checkpoint", "finish"]:
            if self.drawing_line:
                info += "\nCliquez pour placer le deuxième point de la ligne"
            else:
                info += "\nCliquez pour placer le premier point de la ligne"
        elif self.mode == "spawnpoint":
            info += "\nCliquez pour placer un groupe de spawn verticaux (2 lignes de 3)"
        elif self.mode == "spawnpoint_horizontal":
            info += "\nCliquez pour placer un groupe de spawn horizontaux (3 lignes de 2)"
        elif self.mode == "booster":
            info += "\nCliquez pour placer un booster (ligne 32px)"
        elif self.mode == "item":
            info += "\nCliquez pour placer un item (ligne 32px)"
        elif self.mode == "racing_line":
            if self.is_drawing_racing_line:
                info += f"\nPoints: {len(self.current_racing_line)}\nCliquez pour ajouter des points\nEnter pour terminer, Echap pour annuler"
            else:
                info += f"\nCliquez pour commencer la ligne de course"
        elif self.mode == "void_zone":
            if self.is_drawing_void_zone:
                info += f"\nPoints: {len(self.current_void_zone)}\nCliquez pour ajouter des points\nCliquez sur le premier point pour fermer"
            else:
                info += f"\nCliquez pour commencer une zone de vide"
        elif self.mode == "road":
            if self.road_mesh:
                info += f"\nVertices sélectionnés: {len(self.selected_vertices)}"
                info += f"\nShift+Clic: Sélection multiple"
                info += f"\nE: Extruder | C: Virage | G: Déplacer"
                info += f"\nS: Échelle | R: Rotation"
                if self.road_edit_mode:
                    info += f"\nMode: {self.road_edit_mode} - Clic pour confirmer, ESC pour annuler"
            else:
                info += "\nCliquez et glissez pour créer le premier segment de route"
        info += f"\n\nMap: {self.map_name}\nTours: {self.race_settings['laps']}"
        self.info_label.config(text=info)

    def set_mode(self, mode):
        try:
            # Terminer la courbe continue si on change de mode
            if self.mode == "continuous_curve" and self.is_drawing_continuous:
                self.stop_continuous_curve()
            
            # Terminer la ligne de course si on change de mode
            if self.mode == "racing_line" and self.is_drawing_racing_line:
                self.stop_racing_line()
            
            # Terminer la zone de vide si on change de mode
            if self.mode == "void_zone" and self.is_drawing_void_zone:
                self.stop_void_zone()
            
            # Annuler le dessin de ligne en cours
            if self.drawing_line:
                self.drawing_line = False
                self.line_start = None
                self.canvas.delete("temp_line")
                
            self.cancel_edit_operation()
            self.mode = mode
            self.selected_object = None
            self.update_info()
            self.redraw()
            self.log(f"Mode changé : {mode}")
        except Exception as e:
            self.log(f"Erreur dans set_mode: {str(e)}")
            traceback.print_exc()

    def map_settings(self):
        """Dialogue pour configurer les paramètres de la map"""
        dialog = tk.Toplevel(self.root)
        dialog.title("Paramètres de la map")
        dialog.geometry("400x450")
        
        # ID de la map
        tk.Label(dialog, text="ID de la map:").grid(row=0, column=0, padx=10, pady=5, sticky="w")
        id_entry = tk.Entry(dialog, width=30)
        id_entry.insert(0, self.map_id)
        id_entry.grid(row=0, column=1, padx=10, pady=5)
        
        # Nom de la map
        tk.Label(dialog, text="Nom de la map:").grid(row=1, column=0, padx=10, pady=5, sticky="w")
        name_entry = tk.Entry(dialog, width=30)
        name_entry.insert(0, self.map_name)
        name_entry.grid(row=1, column=1, padx=10, pady=5)
        
        # Clé du background
        tk.Label(dialog, text="Chemin background:").grid(row=2, column=0, padx=10, pady=5, sticky="w")
        bg_entry = tk.Entry(dialog, width=30)
        bg_entry.insert(0, self.background_key)
        bg_entry.grid(row=2, column=1, padx=10, pady=5)
        
        # Clé de la musique
        tk.Label(dialog, text="Chemin musique:").grid(row=3, column=0, padx=10, pady=5, sticky="w")
        music_entry = tk.Entry(dialog, width=30)
        music_entry.insert(0, self.music_key)
        music_entry.grid(row=3, column=1, padx=10, pady=5)
        
        # Séparateur
        tk.Frame(dialog, height=2, bg="gray").grid(row=4, column=0, columnspan=2, sticky="ew", pady=10)
        
        # Paramètres de course
        tk.Label(dialog, text="PARAMÈTRES DE COURSE", font=("Arial", 10, "bold")).grid(row=5, column=0, columnspan=2, pady=5)
        
        # Nombre de tours
        tk.Label(dialog, text="Nombre de tours:").grid(row=6, column=0, padx=10, pady=5, sticky="w")
        laps_entry = tk.Entry(dialog, width=30)
        laps_entry.insert(0, str(self.race_settings["laps"]))
        laps_entry.grid(row=6, column=1, padx=10, pady=5)
        
        # Temps maximum (ms)
        tk.Label(dialog, text="Temps max (ms):").grid(row=7, column=0, padx=10, pady=5, sticky="w")
        maxtime_entry = tk.Entry(dialog, width=30)
        maxtime_entry.insert(0, str(self.race_settings["maxTime"]))
        maxtime_entry.grid(row=7, column=1, padx=10, pady=5)
        
        # Temps d'avertissement (ms)
        tk.Label(dialog, text="Temps avertissement (ms):").grid(row=8, column=0, padx=10, pady=5, sticky="w")
        warning_entry = tk.Entry(dialog, width=30)
        warning_entry.insert(0, str(self.race_settings["maxTimeWarning"]))
        warning_entry.grid(row=8, column=1, padx=10, pady=5)
        
        # Info
        tk.Label(dialog, text="(300000 ms = 5 minutes)", font=("Arial", 8), fg="gray").grid(row=9, column=0, columnspan=2)
        
        def save_settings():
            try:
                self.map_id = id_entry.get()
                self.map_name = name_entry.get()
                self.background_key = bg_entry.get()
                self.music_key = music_entry.get()
                
                # Valider et sauvegarder les paramètres de course
                self.race_settings["laps"] = int(laps_entry.get())
                self.race_settings["maxTime"] = int(maxtime_entry.get())
                self.race_settings["maxTimeWarning"] = int(warning_entry.get())
                
                self.update_info()
                dialog.destroy()
            except ValueError:
                messagebox.showerror("Erreur", "Les valeurs numériques doivent être des nombres entiers")
        
        tk.Button(dialog, text="Sauvegarder", command=save_settings, bg="#2ecc71", fg="white").grid(row=10, column=0, columnspan=2, pady=20)

    def load_image(self):
        path = filedialog.askopenfilename(filetypes=[("Image files", "*.png;*.jpg;*.jpeg")])
        if path:
            self.background_path = path
            # Charger et redimensionner l'image à 1536x1024
            img = Image.open(path).resize((1536, 1024))
            self.background_image = ImageTk.PhotoImage(img)
            self.redraw()
            self.log(f"Image chargée et redimensionnée à 1536x1024")

    def stop_continuous_curve(self):
        """Arrête le dessin de la courbe continue"""
        if self.is_drawing_continuous and len(self.current_continuous_curve) >= 2:
            # Vérifier si la courbe est fermée (dernier point identique au premier)
            is_closed = False
            points = list(self.current_continuous_curve)
            
            if len(points) >= 3 and points[0] == points[-1]:
                # La courbe est fermée - retirer le dernier point dupliqué
                points = points[:-1]
                is_closed = True
            
            # Créer un objet courbe continue
            continuous_curve = {
                "points": points,
                "type": "continuous_curve",
                "closed": is_closed
            }
            self.continuous_curves.append(continuous_curve)
            self.actions_stack.append(("add_continuous_curve", continuous_curve))
            
            if is_closed:
                self.log(f"Circuit fermé créé avec {len(points)} points")
            else:
                self.log(f"Courbe continue terminée avec {len(points)} points")
        
        self.is_drawing_continuous = False
        self.current_continuous_curve = []
        self.canvas.delete("temp_continuous")
        self.redraw()
        self.update_info()

    def stop_racing_line(self):
        """Arrête le dessin de la ligne de course"""
        if self.is_drawing_racing_line and len(self.current_racing_line) >= 2:
            # Vérifier si la ligne doit être fermée
            first_point = self.current_racing_line[0]
            last_point = self.current_racing_line[-1]
            
            # Utiliser le flag force_close ou vérifier la distance
            is_closed = (hasattr(self, 'force_close_racing_line') and self.force_close_racing_line) or \
                       math.dist(first_point, last_point) < 30
            
            # Réinitialiser le flag
            if hasattr(self, 'force_close_racing_line'):
                delattr(self, 'force_close_racing_line')
            
            # Calculer la longueur totale de la ligne
            total_length = 0
            points_to_calculate = self.current_racing_line.copy()
            
            # Si c'est fermé, ajouter le segment du dernier au premier point pour le calcul
            if is_closed:
                points_to_calculate.append(first_point)
            
            for i in range(len(points_to_calculate) - 1):
                p1 = points_to_calculate[i]
                p2 = points_to_calculate[i + 1]
                total_length += math.dist(p1, p2)
            
            # Créer l'objet racing line (sans dupliquer le premier point)
            self.racing_line = {
                "points": list(self.current_racing_line),
                "totalLength": total_length,
                "type": "racing_line",
                "closed": is_closed
            }
            
            self.actions_stack.append(("add_racing_line", self.racing_line))
            status = "fermée" if is_closed else "ouverte"
            self.log(f"Ligne de course créée ({status}) avec {len(self.current_racing_line)} points, longueur totale: {total_length:.2f}")
        
        self.is_drawing_racing_line = False
        self.current_racing_line = []
        self.canvas.delete("temp_racing_line")
        self.redraw()
        self.update_info()
    
    def stop_void_zone(self):
        """Arrête le dessin de la zone de vide"""
        if self.is_drawing_void_zone and len(self.current_void_zone) >= 3:
            # Les zones de vide sont toujours fermées
            void_zone = {
                "points": list(self.current_void_zone),
                "type": "void_zone",
                "closed": True
            }
            self.void_zones.append(void_zone)
            self.actions_stack.append(("add_void_zone", void_zone))
            self.log(f"Zone de vide créée avec {len(self.current_void_zone)} points")
        
        self.is_drawing_void_zone = False
        self.current_void_zone = []
        self.canvas.delete("temp_void_zone")
        self.redraw()
        self.update_info()

    def clear_all(self):
        if messagebox.askyesno("Confirmation", "Êtes-vous sûr de vouloir tout effacer ?"):
            self.rectangles = []
            self.curves = []
            self.continuous_curves = []
            self.void_zones = []
            self.road_mesh = []
            self.road_edges = []
            self.road_faces = []
            self.selected_vertices = []
            self.checkpoints = []
            self.spawnpoints = []
            self.boosters = []
            self.items = []
            self.finish_line = None
            self.racing_line = None
            self.actions_stack = []
            self.selected_object = None
            self.current_curve = []
            self.current_continuous_curve = []
            self.current_void_zone = []
            self.current_racing_line = []
            self.is_drawing_continuous = False
            self.is_drawing_void_zone = False
            self.is_drawing_racing_line = False
            self.drawing_line = False
            self.line_start = None
            self.canvas.delete("temp_continuous")
            self.canvas.delete("temp_line")
            self.canvas.delete("temp_void_zone")
            self.canvas.delete("temp_racing_line")
            self.redraw()

    def get_resize_handles(self, rect):
        """Retourne les 8 poignées de redimensionnement d'un rectangle"""
        cx = rect["x"] + rect["width"] / 2
        cy = rect["y"] + rect["height"] / 2
        w = rect["width"]
        h = rect["height"]
        angle = math.radians(rect.get("angle", 0))
        
        # Points de référence (coins et milieux des côtés)
        handle_points = [
            (-w/2, -h/2, "nw"),  # Nord-Ouest
            (0, -h/2, "n"),      # Nord
            (w/2, -h/2, "ne"),   # Nord-Est
            (w/2, 0, "e"),       # Est
            (w/2, h/2, "se"),    # Sud-Est
            (0, h/2, "s"),       # Sud
            (-w/2, h/2, "sw"),   # Sud-Ouest
            (-w/2, 0, "w")       # Ouest
        ]
        
        handles = []
        for dx, dy, handle_type in handle_points:
            # Appliquer la rotation
            rx = cx + dx * math.cos(angle) - dy * math.sin(angle)
            ry = cy + dx * math.sin(angle) + dy * math.cos(angle)
            handles.append((rx, ry, handle_type))
        
        return handles
    
    def get_handle_at_pos(self, x, y, rect):
        """Vérifie si la position est sur une poignée"""
        handles = self.get_resize_handles(rect)
        for hx, hy, handle_type in handles:
            if math.dist((x, y), (hx, hy)) < 8:
                return handle_type
        return None

    def is_point_in_rotated_rect(self, px, py, rect):
        """Vérifie si un point est dans un rectangle tourné"""
        # Transformer le point dans le système de coordonnées du rectangle
        cx = rect["x"] + rect["width"] / 2
        cy = rect["y"] + rect["height"] / 2
        
        angle = -math.radians(rect.get("angle", 0))
        
        # Translater le point par rapport au centre
        tx = px - cx
        ty = py - cy
        
        # Appliquer la rotation inverse
        rx = tx * math.cos(angle) - ty * math.sin(angle)
        ry = tx * math.sin(angle) + ty * math.cos(angle)
        
        # Vérifier si le point est dans le rectangle non tourné
        half_w = rect["width"] / 2
        half_h = rect["height"] / 2
        
        return -half_w <= rx <= half_w and -half_h <= ry <= half_h
    
    def is_point_near_line(self, px, py, line, threshold=10):
        """Vérifie si un point est près d'une ligne"""
        x1, y1 = line["x1"], line["y1"]
        x2, y2 = line["x2"], line["y2"]
        
        # Calculer la distance du point à la ligne
        line_length = math.sqrt((x2 - x1)**2 + (y2 - y1)**2)
        if line_length == 0:
            return math.dist((px, py), (x1, y1)) < threshold
        
        t = max(0, min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / line_length**2))
        projection_x = x1 + t * (x2 - x1)
        projection_y = y1 + t * (y2 - y1)
        
        return math.dist((px, py), (projection_x, projection_y)) < threshold

    def on_motion(self, event):
        self.mouse_pos = (event.x, event.y)
        
        # Prévisualiser la ligne en cours de dessin (seulement pour checkpoints et ligne d'arrivée)
        if self.drawing_line and self.line_start and self.mode in ["checkpoint", "finish"]:
            self.canvas.delete("temp_line")
            color = "yellow"
            self.canvas.create_line(self.line_start[0], self.line_start[1], 
                                   event.x, event.y, 
                                   fill=color, width=3, dash=(5, 5), tags="temp_line")
        
        # Road mode operations
        if self.mode == "road" and self.road_mesh:
            if self.road_edit_mode == "extrude":
                # Calculate extrude preview
                if len(self.selected_vertices) >= 2:
                    # Get the two selected vertices
                    v1 = self.road_mesh[self.selected_vertices[0]]
                    v2 = self.road_mesh[self.selected_vertices[1]]
                    
                    # Calculate edge center and direction
                    edge_center_x = (v1["x"] + v2["x"]) / 2
                    edge_center_y = (v1["y"] + v2["y"]) / 2
                    
                    # Calculate perpendicular to the edge (road direction)
                    edge_dx = v2["x"] - v1["x"]
                    edge_dy = v2["y"] - v1["y"]
                    edge_length = math.sqrt(edge_dx*edge_dx + edge_dy*edge_dy)
                    
                    if edge_length > 0:
                        # Perpendicular direction (90 degrees to the edge)
                        perp_x = -edge_dy / edge_length
                        perp_y = edge_dx / edge_length
                        
                        # Project mouse position onto perpendicular direction
                        mouse_dx = event.x - edge_center_x
                        mouse_dy = event.y - edge_center_y
                        
                        # Distance along perpendicular
                        dist = mouse_dx * perp_x + mouse_dy * perp_y
                        
                        # New positions maintaining road width
                        self.extrude_preview = {
                            "v1": {"x": v1["x"] + perp_x * dist, "y": v1["y"] + perp_y * dist},
                            "v2": {"x": v2["x"] + perp_x * dist, "y": v2["y"] + perp_y * dist}
                        }
                    else:
                        # Fallback to simple offset
                        dx = event.x - edge_center_x
                        dy = event.y - edge_center_y
                        self.extrude_preview = {
                            "v1": {"x": v1["x"] + dx, "y": v1["y"] + dy},
                            "v2": {"x": v2["x"] + dx, "y": v2["y"] + dy}
                        }
                    
                    self.redraw()
                    
            elif self.road_edit_mode == "grab":
                # Move selected vertices
                if hasattr(self, 'edit_start_pos') and hasattr(self, 'original_positions'):
                    dx = event.x - self.edit_start_pos[0]
                    dy = event.y - self.edit_start_pos[1]
                    
                    for i, v_id in enumerate(self.selected_vertices):
                        self.road_mesh[v_id]["x"] = self.original_positions[i]["x"] + dx
                        self.road_mesh[v_id]["y"] = self.original_positions[i]["y"] + dy
                    
                    self.redraw()
                    
            elif self.road_edit_mode == "scale":
                # Scale selected vertices from center
                if hasattr(self, 'edit_start_pos') and hasattr(self, 'scale_center'):
                    dy = event.y - self.edit_start_pos[1]
                    scale_factor = 1.0 + dy / 100.0
                    scale_factor = max(0.1, min(5.0, scale_factor))
                    
                    for i, v_id in enumerate(self.selected_vertices):
                        orig = self.original_positions[i]
                        self.road_mesh[v_id]["x"] = self.scale_center[0] + (orig["x"] - self.scale_center[0]) * scale_factor
                        self.road_mesh[v_id]["y"] = self.scale_center[1] + (orig["y"] - self.scale_center[1]) * scale_factor
                    
                    self.redraw()
                    
            elif self.road_edit_mode == "rotate":
                # Rotate selected vertices
                if hasattr(self, 'rotation_center') and hasattr(self, 'original_positions'):
                    cx, cy = self.rotation_center
                    
                    # Calculate rotation angle
                    start_angle = math.atan2(self.edit_start_pos[1] - cy, self.edit_start_pos[0] - cx)
                    current_angle = math.atan2(event.y - cy, event.x - cx)
                    angle_diff = current_angle - start_angle
                    
                    # Apply rotation
                    cos_a = math.cos(angle_diff)
                    sin_a = math.sin(angle_diff)
                    
                    for i, v_id in enumerate(self.selected_vertices):
                        orig = self.original_positions[i]
                        dx = orig["x"] - cx
                        dy = orig["y"] - cy
                        
                        self.road_mesh[v_id]["x"] = cx + dx * cos_a - dy * sin_a
                        self.road_mesh[v_id]["y"] = cy + dx * sin_a + dy * cos_a
                    
                    self.redraw()
        
        # Changer le curseur selon la position
        if self.mode == "edit" and self.selected_object and not self.edit_mode:
            obj_type = self.selected_object.get("type")
            
            # Pour les rectangles (murs et spawnpoints)
            if obj_type in ["wall", "spawnpoint"]:
                handle = self.get_handle_at_pos(event.x, event.y, self.selected_object)
                if handle:
                    # Définir le curseur selon la poignée
                    if handle in ["n", "s"]:
                        self.canvas.config(cursor="sb_v_double_arrow")
                    elif handle in ["e", "w"]:
                        self.canvas.config(cursor="sb_h_double_arrow")
                    elif handle in ["nw", "se"]:
                        self.canvas.config(cursor="size_nw_se")
                    elif handle in ["ne", "sw"]:
                        self.canvas.config(cursor="size_ne_sw")
                elif self.is_point_in_rotated_rect(event.x, event.y, self.selected_object):
                    self.canvas.config(cursor="fleur")
                else:
                    self.canvas.config(cursor="")
            # Pour les lignes (checkpoints, ligne d'arrivée, boosters, items)
            elif obj_type in ["checkpoint", "finish", "booster", "item"]:
                if self.is_point_near_line(event.x, event.y, self.selected_object):
                    self.canvas.config(cursor="fleur")
                else:
                    self.canvas.config(cursor="")
            else:
                self.canvas.config(cursor="")
        else:
            self.canvas.config(cursor="")
        
        if self.edit_mode and self.selected_object:
            if self.edit_mode == 'grab':
                dx = event.x - self.edit_start_pos[0]
                dy = event.y - self.edit_start_pos[1]
                
                # Pour les lignes
                if self.selected_object.get("type") in ["checkpoint", "finish", "booster", "item"]:
                    self.selected_object["x1"] = self.edit_original_state["x1"] + dx
                    self.selected_object["y1"] = self.edit_original_state["y1"] + dy
                    self.selected_object["x2"] = self.edit_original_state["x2"] + dx
                    self.selected_object["y2"] = self.edit_original_state["y2"] + dy
                # Pour les rectangles
                else:
                    self.selected_object["x"] = self.edit_original_state["x"] + dx
                    self.selected_object["y"] = self.edit_original_state["y"] + dy
                
            elif self.edit_mode == 'resize' and self.resize_handle:
                # Redimensionnement par poignées (seulement pour les rectangles)
                angle = math.radians(self.selected_object.get("angle", 0))
                
                # Position actuelle dans le repère du rectangle
                cx = self.edit_original_state["x"] + self.edit_original_state["width"] / 2
                cy = self.edit_original_state["y"] + self.edit_original_state["height"] / 2
                
                # Transformer la position de la souris dans le repère non tourné
                dx = event.x - cx
                dy = event.y - cy
                local_x = dx * math.cos(-angle) - dy * math.sin(-angle)
                local_y = dx * math.sin(-angle) + dy * math.cos(-angle)
                
                # Calculer les nouvelles dimensions selon la poignée
                if "e" in self.resize_handle:
                    new_width = max(20, local_x * 2)
                    self.selected_object["width"] = new_width
                elif "w" in self.resize_handle:
                    new_width = max(20, -local_x * 2)
                    self.selected_object["width"] = new_width
                    
                if "s" in self.resize_handle:
                    new_height = max(20, local_y * 2)
                    self.selected_object["height"] = new_height
                elif "n" in self.resize_handle:
                    new_height = max(20, -local_y * 2)
                    self.selected_object["height"] = new_height
                
                # Recentrer le rectangle
                self.selected_object["x"] = cx - self.selected_object["width"] / 2
                self.selected_object["y"] = cy - self.selected_object["height"] / 2
                    
            elif self.edit_mode == 'rotate':
                # Pour les lignes
                if self.selected_object.get("type") in ["checkpoint", "finish", "booster", "item"]:
                    # Centre de la ligne
                    cx = (self.selected_object["x1"] + self.selected_object["x2"]) / 2
                    cy = (self.selected_object["y1"] + self.selected_object["y2"]) / 2
                    
                    # Angle actuel de la ligne
                    current_angle = math.atan2(self.selected_object["y2"] - self.selected_object["y1"],
                                             self.selected_object["x2"] - self.selected_object["x1"])
                    
                    # Angle de la souris par rapport au centre
                    mouse_angle = math.atan2(event.y - cy, event.x - cx)
                    
                    # Différence d'angle
                    angle_diff = mouse_angle - math.atan2(self.edit_start_pos[1] - cy, 
                                                          self.edit_start_pos[0] - cx)
                    
                    # Longueur de la ligne
                    length = math.sqrt((self.edit_original_state["x2"] - self.edit_original_state["x1"])**2 + 
                                     (self.edit_original_state["y2"] - self.edit_original_state["y1"])**2)
                    
                    # Nouvel angle
                    new_angle = math.atan2(self.edit_original_state["y2"] - self.edit_original_state["y1"],
                                          self.edit_original_state["x2"] - self.edit_original_state["x1"]) + angle_diff
                    
                    # Recalculer les points
                    half_length = length / 2
                    self.selected_object["x1"] = cx - half_length * math.cos(new_angle)
                    self.selected_object["y1"] = cy - half_length * math.sin(new_angle)
                    self.selected_object["x2"] = cx + half_length * math.cos(new_angle)
                    self.selected_object["y2"] = cy + half_length * math.sin(new_angle)
                # Pour les spawn points - rotation par pas de 90°
                elif self.selected_object.get("type") == "spawnpoint":
                    center = (self.selected_object["x"] + self.selected_object["width"]/2,
                             self.selected_object["y"] + self.selected_object["height"]/2)
                    
                    angle1 = math.atan2(self.edit_start_pos[1] - center[1], self.edit_start_pos[0] - center[0])
                    angle2 = math.atan2(event.y - center[1], event.x - center[0])
                    
                    delta_angle = math.degrees(angle2 - angle1)
                    
                    # Pour les spawn points, arrondir à l'angle de 90° le plus proche
                    current_angle = self.edit_original_state.get("angle", 0)
                    new_angle = current_angle + delta_angle
                    
                    # Arrondir au multiple de 90 le plus proche
                    rounded_angle = round(new_angle / 90) * 90
                    final_angle = rounded_angle % 360
                    
                    # Calculer la différence réelle d'angle à appliquer
                    angle_diff = final_angle - self.edit_original_state.get("angle", 0)
                    
                    # Appliquer la rotation à ce spawn point
                    self.selected_object["angle"] = final_angle
                    
                    # Si c'est un spawn point avec un group_id, tourner tout le groupe
                    if "group_id" in self.selected_object and hasattr(self, 'edit_group_states'):
                        group_id = self.selected_object["group_id"]
                        
                        # Appliquer la même différence d'angle à tous les spawn points du groupe
                        for sp in self.spawnpoints:
                            if sp.get("group_id") == group_id and sp != self.selected_object:
                                # Récupérer l'angle original depuis l'état sauvegardé
                                original_state = self.edit_group_states.get(id(sp))
                                if original_state:
                                    original_angle = original_state.get("angle", 0)
                                    sp["angle"] = (original_angle + angle_diff) % 360
                # Pour les autres rectangles
                else:
                    center = (self.selected_object["x"] + self.selected_object["width"]/2,
                             self.selected_object["y"] + self.selected_object["height"]/2)
                    
                    angle1 = math.atan2(self.edit_start_pos[1] - center[1], self.edit_start_pos[0] - center[0])
                    angle2 = math.atan2(event.y - center[1], event.x - center[0])
                    
                    delta_angle = math.degrees(angle2 - angle1)
                    self.selected_object["angle"] = (self.edit_original_state.get("angle", 0) + delta_angle) % 360
                
            self.redraw()

    def on_click(self, event):
        try:
            if self.edit_mode:
                self.confirm_edit_operation()
                return
                
            if self.mode == "wall":
                rect = {"x": event.x - 50, "y": event.y - 25, "width": 100, "height": 50, "angle": 0, "type": "wall"}
                self.rectangles.append(rect)
                self.actions_stack.append(("add_wall", rect))
                self.log(f"Mur ajouté à la position ({event.x}, {event.y})")
                self.redraw()
                
            elif self.mode == "curve":
                self.current_curve.append((event.x, event.y))
                self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="yellow", tags="temp")
                if len(self.current_curve) == 3:
                    curve = {"points": list(self.current_curve), "type": "curve"}
                    self.curves.append(curve)
                    self.actions_stack.append(("add_curve", curve))
                    self.current_curve = []
                    self.canvas.delete("temp")
                    self.log(f"Courbe ajoutée avec 3 points")
                    self.redraw()
                self.update_info()
                
            elif self.mode == "racing_line":
                if not self.is_drawing_racing_line:
                    # Commencer une nouvelle ligne de course
                    self.is_drawing_racing_line = True
                    self.current_racing_line = [(event.x, event.y)]
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="red", tags="temp_racing_line")
                    self.log(f"Ligne de course commencée - Cliquez pour ajouter des points")
                else:
                    # Vérifier si on clique sur le premier point pour fermer la ligne
                    if len(self.current_racing_line) >= 3:
                        first_point = self.current_racing_line[0]
                        if math.dist((event.x, event.y), first_point) < 15:
                            # Marquer comme fermée sans ajouter de point
                            self.force_close_racing_line = True
                            self.log(f"Ligne de course fermée - circuit complet!")
                            self.stop_racing_line()
                            return
                    
                    # Sinon, ajouter un point normal
                    self.current_racing_line.append((event.x, event.y))
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="red", tags="temp_racing_line")
                    self.redraw()
                
                self.update_info()
                
            elif self.mode == "continuous_curve":
                if not self.is_drawing_continuous:
                    # Commencer une nouvelle courbe continue
                    self.is_drawing_continuous = True
                    self.current_continuous_curve = [(event.x, event.y)]
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="yellow", tags="temp_continuous")
                    self.log(f"Courbe continue commencée")
                else:
                    # Vérifier si on clique sur le premier point pour fermer la courbe
                    if len(self.current_continuous_curve) >= 3:
                        first_point = self.current_continuous_curve[0]
                        if math.dist((event.x, event.y), first_point) < 15:
                            # Fermer la courbe en ajoutant le premier point à la fin
                            self.current_continuous_curve.append(first_point)
                            self.log(f"Courbe fermée - circuit complet!")
                            self.stop_continuous_curve()
                            return
                    
                    # Sinon, ajouter un point normal
                    self.current_continuous_curve.append((event.x, event.y))
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="yellow", tags="temp_continuous")
                    self.redraw()
                
                self.update_info()
                
            elif self.mode == "void_zone":
                if not self.is_drawing_void_zone:
                    # Commencer une nouvelle zone de vide
                    self.is_drawing_void_zone = True
                    self.current_void_zone = [(event.x, event.y)]
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="orange", tags="temp_void_zone")
                    self.log(f"Zone de vide commencée")
                else:
                    # Vérifier si on clique sur le premier point pour fermer la zone
                    if len(self.current_void_zone) >= 3:
                        first_point = self.current_void_zone[0]
                        if math.dist((event.x, event.y), first_point) < 15:
                            # Fermer la zone
                            self.log(f"Zone de vide fermée!")
                            self.stop_void_zone()
                            return
                    
                    # Sinon, ajouter un point normal
                    self.current_void_zone.append((event.x, event.y))
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="orange", tags="temp_void_zone")
                    self.redraw()
                
                self.update_info()
                
            elif self.mode == "checkpoint":
                if not self.drawing_line:
                    # Premier clic - début de la ligne
                    self.drawing_line = True
                    self.line_start = (event.x, event.y)
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="lime", tags="temp_line")
                else:
                    # Deuxième clic - fin de la ligne
                    if self.line_start:
                        cp = {
                            "x1": self.line_start[0],
                            "y1": self.line_start[1],
                            "x2": event.x,
                            "y2": event.y,
                            "type": "checkpoint"
                        }
                        self.checkpoints.append(cp)
                        self.actions_stack.append(("add_checkpoint", cp))
                        self.log(f"Checkpoint ajouté (ligne)")
                        self.drawing_line = False
                        self.line_start = None
                        self.canvas.delete("temp_line")
                        self.redraw()
                self.update_info()
                
            elif self.mode == "finish":
                if not self.drawing_line:
                    # Premier clic - début de la ligne
                    self.drawing_line = True
                    self.line_start = (event.x, event.y)
                    self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="white", tags="temp_line")
                else:
                    # Deuxième clic - fin de la ligne
                    if self.line_start:
                        if self.finish_line:
                            self.actions_stack.append(("remove_finish", self.finish_line))
                        fl = {
                            "x1": self.line_start[0],
                            "y1": self.line_start[1],
                            "x2": event.x,
                            "y2": event.y,
                            "type": "finish"
                        }
                        self.finish_line = fl
                        self.actions_stack.append(("add_finish", fl))
                        self.log(f"Ligne d'arrivée placée")
                        self.drawing_line = False
                        self.line_start = None
                        self.canvas.delete("temp_line")
                        self.redraw()
                self.update_info()
                
            elif self.mode == "spawnpoint":
                # Créer 6 spawn points en grille 2x3 (2 lignes, 3 colonnes) - Vertical
                # Pour départ vertical, les karts doivent regarder vers le haut (angle 270) ou bas (angle 90)
                spacing_x = 35  # Espacement horizontal entre les spawn points (augmenté légèrement)
                spacing_y = 45  # Espacement vertical entre les lignes (augmenté légèrement)
                
                # Position du centre de la grille
                center_x = event.x
                center_y = event.y
                
                # Générer un ID de groupe unique basé sur le timestamp
                group_id = f"group_{len(self.actions_stack)}_{int(event.x)}_{int(event.y)}"
                
                spawn_group = []
                # Créer 2 lignes - la première ligne (plus proche de la ligne d'arrivée) doit être 1,2,3
                # La deuxième ligne (derrière) doit être 4,5,6
                for row in range(2):
                    # Créer 3 colonnes par ligne
                    for col in range(3):
                        # Calculer la position de chaque spawn point
                        x = center_x + (col - 1) * spacing_x  # -1, 0, 1 pour centrer
                        y = center_y + (row - 0.5) * spacing_y  # -0.5, 0.5 pour centrer
                        
                        sp = {
                            "x": x - 15,  # Centrer le spawn point (largeur 30)
                            "y": y - 10,  # Centrer le spawn point (hauteur 20)
                            "angle": 270,  # Angle à 270° pour regarder vers le haut
                            "type": "spawnpoint",
                            "width": 30,
                            "height": 20,
                            "group_id": group_id,  # ID unique du groupe
                            "position": row * 3 + col + 1  # Position explicite: 1-3 pour première ligne, 4-6 pour deuxième
                        }
                        self.spawnpoints.append(sp)
                        spawn_group.append(sp)
                
                self.actions_stack.append(("add_spawnpoint_group", spawn_group))
                self.log(f"Groupe de 6 spawn points ajouté (2 lignes de 3) - Vertical")
                self.redraw()
                
            elif self.mode == "spawnpoint_horizontal":
                # Créer 6 spawn points en grille 3x2 (3 lignes, 2 colonnes) - Horizontal
                # Pour départ horizontal, les karts doivent regarder vers la droite (angle 0) ou gauche (angle 180)
                spacing_x = 45  # Espacement horizontal entre les spawn points (augmenté légèrement)
                spacing_y = 35  # Espacement vertical entre les lignes (augmenté légèrement)
                
                # Position du centre de la grille
                center_x = event.x
                center_y = event.y
                
                # Générer un ID de groupe unique
                group_id = f"group_{len(self.actions_stack)}_{int(event.x)}_{int(event.y)}"
                
                spawn_group = []
                # Créer 3 lignes de 2 colonnes
                # Pour un départ horizontal vers la droite:
                # Colonne 1 (plus proche de la ligne): positions 1, 2, 3
                # Colonne 2 (derrière): positions 4, 5, 6
                # On parcourt par colonne d'abord pour avoir le bon ordre
                temp_spawns = []
                
                # Parcourir par colonne en premier pour l'ordre correct
                for col in range(2):
                    for row in range(3):
                        # Calculer la position de chaque spawn point
                        x = center_x + (col - 0.5) * spacing_x  # -0.5, 0.5 pour centrer
                        y = center_y + (row - 1) * spacing_y  # -1, 0, 1 pour centrer
                        
                        # Position basée sur l'ordre colonne par colonne
                        position = col * 3 + row + 1  # Col 0: 1,2,3; Col 1: 4,5,6
                        
                        sp = {
                            "x": x - 15,  # Centrer le spawn point (largeur 30)
                            "y": y - 10,  # Centrer le spawn point (hauteur 20)
                            "angle": 0,  # Angle à 0° pour regarder vers la droite
                            "type": "spawnpoint",
                            "width": 30,
                            "height": 20,
                            "group_id": group_id,  # ID unique du groupe
                            "position": position
                        }
                        self.spawnpoints.append(sp)
                        spawn_group.append(sp)
                
                self.actions_stack.append(("add_spawnpoint_group", spawn_group))
                self.log(f"Groupe de 6 spawn points ajouté (3 lignes de 2) - Horizontal")
                self.redraw()
                
            elif self.mode == "booster":
                # Créer directement une ligne horizontale de 32px
                booster = {
                    "x1": event.x - 16,
                    "y1": event.y,
                    "x2": event.x + 16,
                    "y2": event.y,
                    "type": "booster"
                }
                self.boosters.append(booster)
                self.actions_stack.append(("add_booster", booster))
                self.log(f"Booster ajouté (ligne 32px)")
                self.redraw()
                
            elif self.mode == "item":
                # Créer directement une ligne horizontale de 32px
                item = {
                    "x1": event.x - 16,
                    "y1": event.y,
                    "x2": event.x + 16,
                    "y2": event.y,
                    "type": "item"
                }
                self.items.append(item)
                self.actions_stack.append(("add_item", item))
                self.log(f"Item ajouté (ligne 32px)")
                self.redraw()
                
            elif self.mode == "road":
                if not self.road_mesh:
                    # Start creating the first road segment
                    self.is_drawing_road = True
                    self.drag_start = (event.x, event.y)
                elif self.road_edit_mode:
                    # Confirm current operation
                    self.confirm_road_operation()
                else:
                    # Select vertices near click point
                    # Check if shift is held
                    shift_held = bool(event.state & 0x0001)  # Shift key state
                    self.select_road_vertices(event.x, event.y, shift_held)
                
            elif self.mode == "edit":
                # Vérifier si on clique sur une poignée de redimensionnement
                if self.selected_object and self.selected_object.get("type") in ["wall", "spawnpoint"]:
                    handle = self.get_handle_at_pos(event.x, event.y, self.selected_object)
                    if handle:
                        self.start_resize_operation(handle)
                        return
                
                # Sinon, sélectionner l'objet cliqué
                self.selected_object = None
                
                # Vérifier d'abord la ligne de course
                if self.racing_line:
                    for point in self.racing_line["points"]:
                        if math.dist((event.x, event.y), point) < 20:
                            self.selected_object = self.racing_line
                            self.log(f"Ligne de course sélectionnée")
                            self.redraw()
                            return
                
                # Vérifier tous les objets
                all_objects = (self.rectangles + self.spawnpoints + self.continuous_curves + self.void_zones)
                
                # Ajouter les lignes (checkpoints, ligne d'arrivée, boosters, items)
                all_lines = self.checkpoints.copy() + self.boosters.copy() + self.items.copy()
                if self.finish_line:
                    all_lines.append(self.finish_line)
                
                # Vérifier les lignes en premier
                for line in all_lines:
                    if self.is_point_near_line(event.x, event.y, line):
                        self.selected_object = line
                        self.log(f"Ligne sélectionnée : {line.get('type', 'unknown')}")
                        self.redraw()
                        return
                
                # Puis vérifier les autres objets
                for obj in all_objects:
                    if obj.get("type") == "continuous_curve":
                        # Pour les courbes continues, vérifier si on clique près d'un point
                        for point in obj["points"]:
                            if math.dist((event.x, event.y), point) < 20:
                                self.selected_object = obj
                                self.log(f"Courbe continue sélectionnée")
                                break
                    elif self.is_point_in_rotated_rect(event.x, event.y, obj):
                        self.selected_object = obj
                        self.log(f"Objet sélectionné : {obj.get('type', 'unknown')}")
                        break
                        
                self.redraw()
                
            elif self.mode == "modify_curve":
                # Pour les courbes normales
                for curve in self.curves:
                    for i, point in enumerate(curve["points"]):
                        if math.dist((event.x, event.y), point) < 15:
                            self.selected_object = (curve, i)
                            self.log(f"Point de courbe sélectionné")
                            return
                
                # Pour les courbes continues
                for curve in self.continuous_curves:
                    for i, point in enumerate(curve["points"]):
                        if math.dist((event.x, event.y), point) < 15:
                            self.selected_object = (curve, i)
                            self.log(f"Point de courbe continue sélectionné")
                            return
                
                # Pour les zones de vide
                for zone in self.void_zones:
                    for i, point in enumerate(zone["points"]):
                        if math.dist((event.x, event.y), point) < 15:
                            self.selected_object = (zone, i)
                            self.log(f"Point de zone de vide sélectionné")
                            return
                            
        except Exception as e:
            self.log(f"Erreur dans on_click: {str(e)}")
            traceback.print_exc()

    def on_drag(self, event):
        if self.mode == "modify_curve" and self.selected_object:
            curve, point_index = self.selected_object
            
            # Modification normale - pas besoin de gérer spécialement les courbes fermées
            # car on ne duplique plus le dernier point
            curve["points"][point_index] = (event.x, event.y)
            
            self.redraw()
        elif self.mode == "road" and self.is_drawing_road:
            # Update mouse position for preview
            self.mouse_pos = (event.x, event.y)
            self.redraw()

    def on_release(self, event):
        if self.mode == "road" and self.is_drawing_road:
            # Create the first road segment as a mesh
            self.is_drawing_road = False
            
            if hasattr(self, 'drag_start'):
                x1, y1 = self.drag_start
                x2, y2 = event.x, event.y
                
                # Calculate perpendicular for road width
                dx = x2 - x1
                dy = y2 - y1
                length = math.sqrt(dx*dx + dy*dy)
                
                if length > 10:  # Minimum length
                    # Normalize and get perpendicular
                    dx /= length
                    dy /= length
                    perp_x = -dy * self.road_width / 2
                    perp_y = dx * self.road_width / 2
                    
                    # Create 4 vertices for the first segment
                    v0 = len(self.road_mesh)
                    self.road_mesh.extend([
                        {"x": x1 + perp_x, "y": y1 + perp_y, "id": v0},
                        {"x": x1 - perp_x, "y": y1 - perp_y, "id": v0 + 1},
                        {"x": x2 - perp_x, "y": y2 - perp_y, "id": v0 + 2},
                        {"x": x2 + perp_x, "y": y2 + perp_y, "id": v0 + 3}
                    ])
                    
                    # Create edges
                    self.road_edges.extend([
                        (v0, v0 + 1),  # Start edge
                        (v0 + 1, v0 + 2),  # Bottom edge
                        (v0 + 2, v0 + 3),  # End edge
                        (v0 + 3, v0),  # Top edge
                    ])
                    
                    # Create road segment (rectangle with 4 vertices)
                    self.road_faces.append((v0, v0 + 1, v0 + 2, v0 + 3))
                    
                    # Select the end edge vertices for next extrusion
                    self.selected_vertices = [v0 + 2, v0 + 3]
                    
                    self.log(f"Premier segment de route créé")
                    self.update_info()
                    self.redraw()
    
    def on_right_click(self, event):
        if self.edit_mode:
            self.cancel_edit_operation()

    def start_resize_operation(self, handle):
        """Démarre une opération de redimensionnement"""
        if self.selected_object:
            self.edit_mode = 'resize'
            self.resize_handle = handle
            self.edit_start_pos = self.mouse_pos
            self.edit_original_state = self.selected_object.copy()
            self.update_info()

    def start_edit_operation(self, operation):
        if self.selected_object and not self.edit_mode:
            self.edit_mode = operation
            self.edit_start_pos = self.mouse_pos
            self.edit_original_state = self.selected_object.copy()
            
            # Pour la rotation groupée des spawn points, sauvegarder l'état de tout le groupe
            if operation == 'rotate' and self.selected_object.get("type") == "spawnpoint" and "group_id" in self.selected_object:
                self.edit_group_states = {}
                group_id = self.selected_object["group_id"]
                for sp in self.spawnpoints:
                    if sp.get("group_id") == group_id:
                        self.edit_group_states[id(sp)] = sp.copy()
            
            self.update_info()

    def confirm_edit_operation(self):
        if self.edit_mode and self.selected_object:
            self.actions_stack.append(("edit", (self.selected_object, self.edit_original_state)))
            self.edit_mode = None
            self.edit_start_pos = None
            self.edit_original_state = None
            self.update_info()

    def cancel_edit_operation(self):
        if self.edit_mode and self.selected_object and self.edit_original_state:
            # Restaurer l'état original
            for key, value in self.edit_original_state.items():
                self.selected_object[key] = value
            
            # Pour la rotation groupée, restaurer tout le groupe
            if self.edit_mode == 'rotate' and hasattr(self, 'edit_group_states'):
                for sp in self.spawnpoints:
                    original_state = self.edit_group_states.get(id(sp))
                    if original_state:
                        for key, value in original_state.items():
                            sp[key] = value
            
            self.redraw()
        self.edit_mode = None
        self.edit_start_pos = None
        self.edit_original_state = None
        if hasattr(self, 'edit_group_states'):
            delattr(self, 'edit_group_states')
        self.update_info()

    def delete_selected(self):
        if self.mode == "edit" and self.selected_object:
            obj_type = self.selected_object.get("type")
            
            if obj_type == "wall":
                self.rectangles.remove(self.selected_object)
                self.actions_stack.append(("remove_wall", self.selected_object))
            elif obj_type == "checkpoint":
                self.checkpoints.remove(self.selected_object)
                self.actions_stack.append(("remove_checkpoint", self.selected_object))
            elif obj_type == "finish":
                self.finish_line = None
                self.actions_stack.append(("remove_finish", self.selected_object))
            elif obj_type == "spawnpoint":
                self.spawnpoints.remove(self.selected_object)
                self.actions_stack.append(("remove_spawnpoint", self.selected_object))
            elif obj_type == "booster":
                self.boosters.remove(self.selected_object)
                self.actions_stack.append(("remove_booster", self.selected_object))
            elif obj_type == "item":
                self.items.remove(self.selected_object)
                self.actions_stack.append(("remove_item", self.selected_object))
            elif obj_type == "continuous_curve":
                self.continuous_curves.remove(self.selected_object)
                self.actions_stack.append(("remove_continuous_curve", self.selected_object))
            elif obj_type == "void_zone":
                self.void_zones.remove(self.selected_object)
                self.actions_stack.append(("remove_void_zone", self.selected_object))
            elif obj_type == "racing_line":
                self.actions_stack.append(("remove_racing_line", self.racing_line))
                self.racing_line = None
                
            self.selected_object = None
            self.redraw()

    def draw_rotated_rect(self, rect, selected=False):
        angle = math.radians(rect.get("angle", 0))
        cx = rect["x"] + rect["width"] / 2
        cy = rect["y"] + rect["height"] / 2
        
        # Calculer les 4 coins
        corners = [
            (-rect["width"]/2, -rect["height"]/2),
            (rect["width"]/2, -rect["height"]/2),
            (rect["width"]/2, rect["height"]/2),
            (-rect["width"]/2, rect["height"]/2)
        ]
        
        # Tourner et translater les coins
        rotated = []
        for dx, dy in corners:
            rx = cx + dx * math.cos(angle) - dy * math.sin(angle)
            ry = cy + dx * math.sin(angle) + dy * math.cos(angle)
            rotated.append((rx, ry))
        
        # Définir la couleur selon le type
        colors = {
            "wall": "red",
            "spawnpoint": "#9b59b6"
        }
        color = colors.get(rect.get("type"), "gray")
        
        # Dessiner le rectangle
        if selected:
            # Contour de sélection
            self.canvas.create_polygon(rotated, fill="", outline="cyan", width=3, dash=(5, 5))
            
            # Dessiner les poignées de redimensionnement (sauf pour spawnpoints)
            if not self.edit_mode and rect.get("type") != "spawnpoint":
                handles = self.get_resize_handles(rect)
                for hx, hy, _ in handles:
                    self.canvas.create_rectangle(hx-5, hy-5, hx+5, hy+5, 
                                               fill="cyan", outline="white", width=1)
        
        # Dessiner selon le type
        if rect.get("type") == "spawnpoint":
            # Dessiner une flèche pour indiquer la direction
            self.canvas.create_polygon(rotated, fill="", outline=color, width=2)
            # Ajouter une flèche directionnelle
            arrow_start = (cx - 10 * math.cos(angle), cy - 10 * math.sin(angle))
            arrow_end = (cx + 10 * math.cos(angle), cy + 10 * math.sin(angle))
            self.canvas.create_line(*arrow_start, *arrow_end, fill=color, width=3, arrow=tk.LAST)
        else:
            self.canvas.create_polygon(rotated, fill="", outline=color, width=2)
        
        return rotated
    
    def draw_line_with_arrow(self, line, color, selected=False):
        """Dessine une ligne avec une flèche directionnelle au milieu"""
        x1, y1 = line["x1"], line["y1"]
        x2, y2 = line["x2"], line["y2"]
        
        # Centre de la ligne
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        
        # Vecteur de la ligne
        dx = x2 - x1
        dy = y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        
        if length == 0:
            return
            
        # Normaliser le vecteur
        dx /= length
        dy /= length
        
        # Vecteur normal (perpendiculaire) - pointe vers la droite de la ligne
        nx = -dy
        ny = dx
        
        # Épaisseur et style selon sélection
        width = 5 if selected else 3
        
        # Dessiner la ligne principale
        if selected:
            # Ligne de sélection
            self.canvas.create_line(x1, y1, x2, y2, fill="cyan", width=width+4, dash=(5, 5))
        
        # Ligne principale
        self.canvas.create_line(x1, y1, x2, y2, fill=color, width=width)
        
        # Points aux extrémités
        if selected or self.mode == "edit":
            size = 6 if selected else 4
            self.canvas.create_oval(x1-size, y1-size, x1+size, y1+size, fill=color, outline="white")
            self.canvas.create_oval(x2-size, y2-size, x2+size, y2+size, fill=color, outline="white")
        
        # Dessiner la flèche directionnelle au centre
        arrow_length = 25
        arrow_width = 15
        
        # Point de base de la flèche (légèrement en arrière du centre)
        base_x = cx - nx * 5
        base_y = cy - ny * 5
        
        # Point de la flèche
        arrow_tip_x = cx + nx * arrow_length
        arrow_tip_y = cy + ny * arrow_length
        
        # Points latéraux de la flèche
        side1_x = base_x + dx * arrow_width/2
        side1_y = base_y + dy * arrow_width/2
        side2_x = base_x - dx * arrow_width/2
        side2_y = base_y - dy * arrow_width/2
        
        # Dessiner la flèche
        arrow_color = "white" if line.get("type") == "finish" else "#00FF00"
        if line.get("type") == "booster":
            arrow_color = "#ff9900"
        elif line.get("type") == "item":
            arrow_color = "#00ffff"
            
        self.canvas.create_polygon(
            arrow_tip_x, arrow_tip_y,
            side1_x, side1_y,
            side2_x, side2_y,
            fill=arrow_color,
            outline="black",
            width=2
        )
        
        # Dessiner un cercle au centre pour plus de clarté
        self.canvas.create_oval(cx-3, cy-3, cx+3, cy+3, fill=arrow_color, outline="black")

    def draw_line(self, line, selected=False):
        """Dessine une ligne (checkpoint, ligne d'arrivée, booster ou item) avec flèche directionnelle"""
        x1, y1 = line["x1"], line["y1"]
        x2, y2 = line["x2"], line["y2"]
        
        # Définir la couleur selon le type
        colors = {
            "checkpoint": "lime",
            "finish": "white",
            "booster": "#f39c12",
            "item": "#1abc9c"
        }
        color = colors.get(line.get("type"), "gray")
        
        # Dessiner la ligne avec flèche
        self.draw_line_with_arrow(line, color, selected)
        
        # Si c'est une ligne d'arrivée, ajouter un pattern damier
        if line.get("type") == "finish":
            # Calculer la normale à la ligne
            dx = x2 - x1
            dy = y2 - y1
            length = math.sqrt(dx*dx + dy*dy)
            if length > 0:
                # Vecteur normal unitaire
                nx = -dy / length
                ny = dx / length
                
                # Dessiner des petits carrés le long de la ligne
                segments = int(length / 10)
                for i in range(segments):
                    t = i / segments
                    px = x1 + t * dx
                    py = y1 + t * dy
                    
                    # Alterner noir et blanc
                    color = "white" if i % 2 == 0 else "black"
                    size = 3
                    self.canvas.create_rectangle(px-size + nx*5, py-size + ny*5, 
                                               px+size + nx*5, py+size + ny*5, 
                                               fill=color, outline="")
        
        # Si c'est un booster, ajouter des lignes de vitesse
        elif line.get("type") == "booster":
            # Calculer la normale à la ligne
            dx = x2 - x1
            dy = y2 - y1
            length = math.sqrt(dx*dx + dy*dy)
            if length > 0:
                # Vecteur normal unitaire
                nx = -dy / length
                ny = dx / length
                
                # Dessiner des petites lignes de vitesse
                segments = int(length / 20)
                for i in range(segments):
                    t = i / segments
                    px = x1 + t * dx
                    py = y1 + t * dy
                    
                    # Petites lignes orange
                    self.canvas.create_line(px, py, px + nx*10, py + ny*10, 
                                          fill="#ff6600", width=2)
        
        # Si c'est un item, ajouter des points d'interrogation
        elif line.get("type") == "item":
            # Centre de la ligne
            cx = (x1 + x2) / 2
            cy = (y1 + y2) / 2
            
            # Dessiner un "?" au centre
            self.canvas.create_text(cx, cy, text="?", fill="white", 
                                  font=("Arial", 16, "bold"))

    def draw_racing_line(self, racing_line, selected=False):
        """Dessine la ligne de course"""
        points = racing_line["points"]
        if len(points) < 2:
            return
        
        # Déterminer si la ligne est fermée
        is_closed = racing_line.get("closed", False)
        
        # Dessiner tous les segments
        for i in range(len(points) - 1):
            p1 = points[i]
            p2 = points[i + 1]
            
            # Ligne principale
            color = "cyan" if selected else "red"
            width = 4 if selected else 2
            self.canvas.create_line(p1[0], p1[1], p2[0], p2[1], fill=color, width=width)
            
            # Flèches directionnelles tous les 5 segments
            if i % 5 == 0:
                dx = p2[0] - p1[0]
                dy = p2[1] - p1[1]
                length = math.sqrt(dx*dx + dy*dy)
                if length > 0:
                    dx /= length
                    dy /= length
                    
                    # Point au milieu du segment
                    mx = (p1[0] + p2[0]) / 2
                    my = (p1[1] + p2[1]) / 2
                    
                    # Flèche
                    arrow_length = 15
                    arrow_angle = 0.4
                    
                    arrow_x = mx + dx * arrow_length
                    arrow_y = my + dy * arrow_length
                    
                    left_x = mx - dx * arrow_length/3 - dy * arrow_length * arrow_angle
                    left_y = my - dy * arrow_length/3 + dx * arrow_length * arrow_angle
                    
                    right_x = mx - dx * arrow_length/3 + dy * arrow_length * arrow_angle
                    right_y = my - dy * arrow_length/3 - dx * arrow_length * arrow_angle
                    
                    self.canvas.create_polygon(arrow_x, arrow_y, left_x, left_y, right_x, right_y,
                                             fill="yellow", outline="darkred", width=1)
        
        # Si la ligne est fermée, dessiner le segment de fermeture
        if is_closed and len(points) >= 3:
            p1 = points[-1]  # Dernier point
            p2 = points[0]   # Premier point
            
            # Ligne de fermeture
            color = "cyan" if selected else "red"
            width = 4 if selected else 2
            self.canvas.create_line(p1[0], p1[1], p2[0], p2[1], fill=color, width=width)
            
            # Flèche sur le segment de fermeture si c'est un multiple de 5
            if (len(points) - 1) % 5 == 0:
                dx = p2[0] - p1[0]
                dy = p2[1] - p1[1]
                length = math.sqrt(dx*dx + dy*dy)
                if length > 0:
                    dx /= length
                    dy /= length
                    
                    mx = (p1[0] + p2[0]) / 2
                    my = (p1[1] + p2[1]) / 2
                    
                    arrow_length = 15
                    arrow_angle = 0.4
                    
                    arrow_x = mx + dx * arrow_length
                    arrow_y = my + dy * arrow_length
                    
                    left_x = mx - dx * arrow_length/3 - dy * arrow_length * arrow_angle
                    left_y = my - dy * arrow_length/3 + dx * arrow_length * arrow_angle
                    
                    right_x = mx - dx * arrow_length/3 + dy * arrow_length * arrow_angle
                    right_y = my - dy * arrow_length/3 - dx * arrow_length * arrow_angle
                    
                    self.canvas.create_polygon(arrow_x, arrow_y, left_x, left_y, right_x, right_y,
                                             fill="yellow", outline="darkred", width=1)
        
        # Afficher les points en mode édition
        if self.mode == "modify_curve" or selected:
            for i, point in enumerate(points):
                # Taille et couleur selon la sélection
                size = 6
                fill_color = "orange"
                
                # Premier point en vert
                if i == 0:
                    fill_color = "lime"
                
                self.canvas.create_oval(point[0]-size, point[1]-size, 
                                      point[0]+size, point[1]+size, 
                                      fill=fill_color, outline="white", width=2)
    
    def draw_continuous_curve(self, curve, selected=False):
        """Dessine une courbe continue comme un seul chemin"""
        points = curve["points"]
        if len(points) < 2:
            return
            
        # Créer un chemin lisse à travers tous les points
        # Utiliser l'interpolation de Catmull-Rom pour une courbe lisse
        path_points = []
        
        # Déterminer le nombre de segments à dessiner
        is_closed = curve.get("closed", False)
        num_segments = len(points) if is_closed else len(points) - 1
        
        for i in range(num_segments):
            # Pour une courbe fermée, on boucle sur les indices
            if is_closed:
                p0 = points[(i - 1) % len(points)]
                p1 = points[i]
                p2 = points[(i + 1) % len(points)]
                p3 = points[(i + 2) % len(points)]
            else:
                # Pour une courbe ouverte, on limite aux bornes
                p0 = points[max(0, i-1)]
                p1 = points[i]
                p2 = points[min(len(points)-1, i+1)]
                p3 = points[min(len(points)-1, i+2)]
            
            # Générer des points intermédiaires
            for t in range(0, 11):  # 11 points entre chaque paire
                t = t / 10.0
                
                # Interpolation de Catmull-Rom
                t2 = t * t
                t3 = t2 * t
                
                x = 0.5 * ((2 * p1[0]) +
                          (-p0[0] + p2[0]) * t +
                          (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0]) * t2 +
                          (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0]) * t3)
                
                y = 0.5 * ((2 * p1[1]) +
                          (-p0[1] + p2[1]) * t +
                          (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1]) * t2 +
                          (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1]) * t3)
                
                path_points.append((x, y))
        
        # Pour une courbe non fermée, ajouter le dernier point
        if not is_closed:
            path_points.append(points[-1])
        
        # Dessiner la courbe comme une ligne continue épaisse
        for i in range(len(path_points) - 1):
            color = "cyan" if selected else "orange"
            width = 5 if selected else 3
            self.canvas.create_line(path_points[i][0], path_points[i][1],
                                  path_points[i+1][0], path_points[i+1][1],
                                  fill=color, width=width, capstyle=tk.ROUND, joinstyle=tk.ROUND)
        
        # Afficher les points de contrôle si en mode modify_curve
        if self.mode == "modify_curve":
            for i, point in enumerate(points):
                # Vérifier si ce point est sélectionné
                is_selected = (selected and isinstance(self.selected_object, tuple) and 
                             self.selected_object[1] == i)
                size = 8 if is_selected else 6
                fill_color = "red" if is_selected else "yellow"
                
                # Point de fermeture (premier point d'une courbe fermée) en vert
                if curve.get("closed", False) and i == 0:
                    fill_color = "lime" if not is_selected else "red"
                
                self.canvas.create_oval(point[0]-size, point[1]-size, 
                                      point[0]+size, point[1]+size, 
                                      fill=fill_color, outline="white", width=2)

    def draw_curve(self, curve, selected=False):
        points = curve["points"]
        if len(points) != 3:
            return
            
        p0, p1, p2 = points
        
        # Dessiner la courbe de Bézier
        coords = []
        for t in [i/20 for i in range(21)]:
            x = (1-t)**2*p0[0] + 2*(1-t)*t*p1[0] + t**2*p2[0]
            y = (1-t)**2*p0[1] + 2*(1-t)*t*p1[1] + t**2*p2[1]
            coords.append((x, y))
            
        for i in range(len(coords)-1):
            self.canvas.create_line(*coords[i], *coords[i+1], fill="orange", width=3)
        
        # Afficher les points de contrôle en mode modify_curve
        if self.mode == "modify_curve":
            for i, point in enumerate(points):
                color = "yellow" if i == 1 else "orange"
                size = 8 if selected and self.selected_object and self.selected_object[1] == i else 5
                self.canvas.create_oval(point[0]-size, point[1]-size, 
                                      point[0]+size, point[1]+size, 
                                      fill=color, outline="white")
    
    def draw_void_zone(self, zone, selected=False):
        """Dessine une zone de vide avec un remplissage semi-transparent"""
        points = zone["points"]
        if len(points) < 3:
            return
            
        # Créer un polygone semi-transparent
        # Convertir les points en liste plate pour create_polygon
        flat_points = []
        for point in points:
            flat_points.extend([point[0], point[1]])
        
        # Dessiner le polygone avec remplissage semi-transparent
        fill_color = "#ff6b35" if not selected else "#ff8855"
        outline_color = "#ff4500" if not selected else "#ff6600"
        
        # Zone remplie semi-transparente
        self.canvas.create_polygon(flat_points, 
                                 fill=fill_color, 
                                 outline=outline_color,
                                 width=3,
                                 stipple="gray50")  # Motif pour simuler la transparence
        
        # Contour plus visible
        for i in range(len(points)):
            p1 = points[i]
            p2 = points[(i + 1) % len(points)]
            self.canvas.create_line(p1[0], p1[1], p2[0], p2[1],
                                  fill=outline_color, width=3)
        
        # Afficher les points de contrôle si en mode modify_curve
        if self.mode == "modify_curve":
            for i, point in enumerate(points):
                is_selected = (selected and isinstance(self.selected_object, tuple) and 
                             self.selected_object[1] == i)
                size = 8 if is_selected else 6
                fill_color = "red" if is_selected else "orange"
                
                self.canvas.create_oval(point[0]-size, point[1]-size, 
                                      point[0]+size, point[1]+size, 
                                      fill=fill_color, outline="white", width=2)

    def redraw(self):
        try:
            self.canvas.delete("all")
            
            # Afficher l'image de fond
            if self.background_image:
                self.canvas.create_image(0, 0, image=self.background_image, anchor="nw")
            
            # Dessiner tous les éléments
            for rect in self.rectangles:
                self.draw_rotated_rect(rect, selected=(rect == self.selected_object))
                
            # Dessiner les checkpoints (lignes)
            for checkpoint in self.checkpoints:
                self.draw_line(checkpoint, selected=(checkpoint == self.selected_object))
                
            # Dessiner la ligne d'arrivée
            if self.finish_line:
                self.draw_line(self.finish_line, selected=(self.finish_line == self.selected_object))
                
            for curve in self.curves:
                selected = (self.selected_object and isinstance(self.selected_object, tuple) and 
                           self.selected_object[0] == curve)
                self.draw_curve(curve, selected)
                
            for continuous_curve in self.continuous_curves:
                selected = (self.selected_object and isinstance(self.selected_object, tuple) and 
                           self.selected_object[0] == continuous_curve)
                self.draw_continuous_curve(continuous_curve, selected)
                
            # Dessiner les zones de vide
            for void_zone in self.void_zones:
                selected = (self.selected_object and isinstance(self.selected_object, tuple) and 
                           self.selected_object[0] == void_zone)
                self.draw_void_zone(void_zone, selected)
                
            # Draw road mesh
            self.draw_road_mesh()
            
            # Draw road preview if creating first segment
            if self.is_drawing_road and hasattr(self, 'drag_start'):
                self.draw_road_preview()
                
            # Dessiner la courbe continue en cours
            if self.is_drawing_continuous and len(self.current_continuous_curve) > 1:
                # Dessiner les lignes temporaires
                for i in range(len(self.current_continuous_curve) - 1):
                    self.canvas.create_line(self.current_continuous_curve[i][0], 
                                          self.current_continuous_curve[i][1],
                                          self.current_continuous_curve[i+1][0], 
                                          self.current_continuous_curve[i+1][1],
                                          fill="yellow", width=2, dash=(5, 5))
                
                # Si on a au moins 3 points, montrer où on peut fermer la courbe
                if len(self.current_continuous_curve) >= 3:
                    first_point = self.current_continuous_curve[0]
                    # Dessiner un cercle plus grand autour du premier point pour indiquer qu'on peut fermer
                    self.canvas.create_oval(first_point[0]-12, first_point[1]-12, 
                                          first_point[0]+12, first_point[1]+12, 
                                          fill="", outline="lime", width=3, dash=(3, 3))
                    # Ligne en pointillés du dernier point au premier
                    last_point = self.current_continuous_curve[-1]
                    self.canvas.create_line(last_point[0], last_point[1],
                                          first_point[0], first_point[1],
                                          fill="lime", width=1, dash=(5, 5))
                
                # Dessiner les points
                for i, point in enumerate(self.current_continuous_curve):
                    color = "lime" if i == 0 and len(self.current_continuous_curve) >= 3 else "yellow"
                    self.canvas.create_oval(point[0]-5, point[1]-5, point[0]+5, point[1]+5, 
                                          fill=color, outline="white", tags="temp_continuous")
                
            # Dessiner la zone de vide en cours
            if self.is_drawing_void_zone and len(self.current_void_zone) > 1:
                # Dessiner les lignes temporaires
                for i in range(len(self.current_void_zone) - 1):
                    self.canvas.create_line(self.current_void_zone[i][0], 
                                          self.current_void_zone[i][1],
                                          self.current_void_zone[i+1][0], 
                                          self.current_void_zone[i+1][1],
                                          fill="orange", width=2, dash=(5, 5))
                
                # Si on a au moins 3 points, montrer où on peut fermer la zone
                if len(self.current_void_zone) >= 3:
                    first_point = self.current_void_zone[0]
                    # Dessiner un cercle plus grand autour du premier point pour indiquer qu'on peut fermer
                    self.canvas.create_oval(first_point[0]-12, first_point[1]-12, 
                                          first_point[0]+12, first_point[1]+12, 
                                          fill="", outline="red", width=3, dash=(3, 3))
                    # Ligne en pointillés du dernier point au premier
                    last_point = self.current_void_zone[-1]
                    self.canvas.create_line(last_point[0], last_point[1],
                                          first_point[0], first_point[1],
                                          fill="red", width=1, dash=(5, 5))
                
                # Dessiner les points
                for i, point in enumerate(self.current_void_zone):
                    color = "red" if i == 0 and len(self.current_void_zone) >= 3 else "orange"
                    self.canvas.create_oval(point[0]-5, point[1]-5, point[0]+5, point[1]+5, 
                                          fill=color, outline="white", tags="temp_void_zone")
                
            for spawnpoint in self.spawnpoints:
                self.draw_rotated_rect(spawnpoint, selected=(spawnpoint == self.selected_object))
                
            # Dessiner les boosters (lignes)
            for booster in self.boosters:
                self.draw_line(booster, selected=(booster == self.selected_object))
                
            # Dessiner les items (lignes)
            for item in self.items:
                self.draw_line(item, selected=(item == self.selected_object))
                
            # Dessiner la ligne de course
            if self.racing_line:
                self.draw_racing_line(self.racing_line, selected=(self.racing_line == self.selected_object))
                
            # Dessiner la ligne de course en cours de création
            if self.is_drawing_racing_line and len(self.current_racing_line) > 0:
                # Dessiner les lignes temporaires
                for i in range(len(self.current_racing_line) - 1):
                    p1 = self.current_racing_line[i]
                    p2 = self.current_racing_line[i + 1]
                    self.canvas.create_line(p1[0], p1[1], p2[0], p2[1],
                                          fill="red", width=2, dash=(5, 5), tags="temp_racing_line")
                    
                    # Dessiner des flèches directionnelles
                    if i % 3 == 0:  # Toutes les 3 segments
                        dx = p2[0] - p1[0]
                        dy = p2[1] - p1[1]
                        length = math.sqrt(dx*dx + dy*dy)
                        if length > 0:
                            dx /= length
                            dy /= length
                            mx = (p1[0] + p2[0]) / 2
                            my = (p1[1] + p2[1]) / 2
                            
                            arrow_length = 10
                            arrow_angle = 0.4
                            arrow_x = mx + dx * arrow_length
                            arrow_y = my + dy * arrow_length
                            left_x = mx - dx * arrow_length/3 - dy * arrow_length * arrow_angle
                            left_y = my - dy * arrow_length/3 + dx * arrow_length * arrow_angle
                            right_x = mx - dx * arrow_length/3 + dy * arrow_length * arrow_angle
                            right_y = my - dy * arrow_length/3 - dx * arrow_length * arrow_angle
                            
                            self.canvas.create_polygon(arrow_x, arrow_y, left_x, left_y, right_x, right_y,
                                                     fill="yellow", outline="red", width=1, tags="temp_racing_line")
                
                # Si on a au moins 3 points, montrer où on peut fermer la ligne
                if len(self.current_racing_line) >= 3:
                    first_point = self.current_racing_line[0]
                    last_point = self.current_racing_line[-1]
                    
                    # Vérifier si on est proche du premier point (presque fermé)
                    is_near_closing = math.dist(last_point, first_point) < 50
                    
                    # Dessiner un cercle plus grand autour du premier point pour indiquer qu'on peut fermer
                    self.canvas.create_oval(first_point[0]-12, first_point[1]-12, 
                                          first_point[0]+12, first_point[1]+12, 
                                          fill="", outline="lime", width=3, dash=(3, 3), tags="temp_racing_line")
                    
                    # Si on est proche, dessiner la ligne de fermeture
                    if is_near_closing:
                        # Ligne solide pour montrer que ça va se fermer
                        self.canvas.create_line(last_point[0], last_point[1],
                                              first_point[0], first_point[1],
                                              fill="red", width=2, tags="temp_racing_line")
                        
                        # Flèche sur le segment de fermeture
                        dx = first_point[0] - last_point[0]
                        dy = first_point[1] - last_point[1]
                        length = math.sqrt(dx*dx + dy*dy)
                        if length > 0:
                            dx /= length
                            dy /= length
                            mx = (last_point[0] + first_point[0]) / 2
                            my = (last_point[1] + first_point[1]) / 2
                            
                            arrow_length = 10
                            arrow_angle = 0.4
                            arrow_x = mx + dx * arrow_length
                            arrow_y = my + dy * arrow_length
                            left_x = mx - dx * arrow_length/3 - dy * arrow_length * arrow_angle
                            left_y = my - dy * arrow_length/3 + dx * arrow_length * arrow_angle
                            right_x = mx - dx * arrow_length/3 + dy * arrow_length * arrow_angle
                            right_y = my - dy * arrow_length/3 - dx * arrow_length * arrow_angle
                            
                            self.canvas.create_polygon(arrow_x, arrow_y, left_x, left_y, right_x, right_y,
                                                     fill="yellow", outline="red", width=1, tags="temp_racing_line")
                    else:
                        # Ligne en pointillés si on est loin
                        self.canvas.create_line(last_point[0], last_point[1],
                                              first_point[0], first_point[1],
                                              fill="lime", width=1, dash=(5, 5), tags="temp_racing_line")
                
                # Dessiner les points
                for i, point in enumerate(self.current_racing_line):
                    color = "lime" if i == 0 and len(self.current_racing_line) >= 3 else "red"
                    self.canvas.create_oval(point[0]-5, point[1]-5, point[0]+5, point[1]+5, 
                                          fill=color, outline="white", tags="temp_racing_line")
                
        except Exception as e:
            self.log(f"Erreur dans redraw: {str(e)}")
            traceback.print_exc()

    def undo(self):
        if self.actions_stack:
            action, data = self.actions_stack.pop()
            
            if action == "add_wall":
                self.rectangles.remove(data)
            elif action == "remove_wall":
                self.rectangles.append(data)
            elif action == "add_curve":
                self.curves.remove(data)
            elif action == "remove_curve":
                self.curves.append(data)
            elif action == "add_continuous_curve":
                self.continuous_curves.remove(data)
            elif action == "remove_continuous_curve":
                self.continuous_curves.append(data)
            elif action == "add_void_zone":
                self.void_zones.remove(data)
            elif action == "remove_void_zone":
                self.void_zones.append(data)
            elif action == "add_road":
                self.roads.remove(data)
            elif action == "remove_road":
                self.roads.append(data)
            elif action == "add_checkpoint":
                self.checkpoints.remove(data)
            elif action == "remove_checkpoint":
                self.checkpoints.append(data)
            elif action == "add_finish":
                self.finish_line = None
            elif action == "remove_finish":
                self.finish_line = data
            elif action == "add_spawnpoint":
                self.spawnpoints.remove(data)
            elif action == "remove_spawnpoint":
                self.spawnpoints.append(data)
            elif action == "add_spawnpoint_group":
                # Retirer les 6 derniers spawn points
                for sp in data:
                    self.spawnpoints.remove(sp)
            elif action == "add_booster":
                self.boosters.remove(data)
            elif action == "remove_booster":
                self.boosters.append(data)
            elif action == "add_item":
                self.items.remove(data)
            elif action == "remove_item":
                self.items.append(data)
            elif action == "edit":
                obj, old_state = data
                for key, value in old_state.items():
                    obj[key] = value
            elif action == "add_racing_line":
                self.racing_line = None
            elif action == "remove_racing_line":
                self.racing_line = data
                    
            self.redraw()

    def import_json(self):
        """Importer une map depuis un fichier JSON"""
        file_path = filedialog.askopenfilename(defaultextension=".json", 
                                              filetypes=[("JSON files", "*.json")])
        if file_path:
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
                
                # Réinitialiser
                self.clear_all()
                
                # Charger les paramètres
                self.map_id = data.get("id", "imported_track")
                self.map_name = data.get("name", "imported_track")
                self.background_key = data.get("background", "assets/background.png")
                self.music_key = data.get("music", "assets/audio/theme.mp3")
                
                # Charger les paramètres de course
                if "raceSettings" in data:
                    self.race_settings = data["raceSettings"]
                
                # Charger les murs
                for wall in data.get("walls", []):
                    wall["type"] = "wall"
                    self.rectangles.append(wall)
                
                # Charger les courbes
                for curve_data in data.get("curves", []):
                    curve = {"points": curve_data.get("points", []), "type": "curve"}
                    self.curves.append(curve)
                
                # Charger les courbes continues
                for cc_data in data.get("continuousCurves", []):
                    cc = {
                        "points": cc_data.get("points", []),
                        "type": "continuous_curve",
                        "closed": cc_data.get("closed", False)
                    }
                    self.continuous_curves.append(cc)
                
                # Charger les zones de vide
                for vz_data in data.get("voidZones", []):
                    vz = {
                        "points": vz_data.get("points", []),
                        "type": "void_zone",
                        "closed": True
                    }
                    self.void_zones.append(vz)
                
                # Charger les routes
                for road_data in data.get("roads", []):
                    road = {
                        "x1": road_data.get("x1", 0),
                        "y1": road_data.get("y1", 0),
                        "x2": road_data.get("x2", 0),
                        "y2": road_data.get("y2", 0),
                        "width": road_data.get("width", 80),
                        "type": "road"
                    }
                    self.roads.append(road)
                
                # Charger les checkpoints
                for cp in data.get("checkpoints", []):
                    # Convertir l'ancien format rectangle en ligne si nécessaire
                    if "width" in cp:
                        # Ancien format - convertir en ligne
                        cx = cp["x"] + cp["width"] / 2
                        cy = cp["y"] + cp["height"] / 2
                        angle = (cp.get("angle", 0) + 90) * math.pi / 180
                        half_length = cp["height"] / 2
                        
                        checkpoint = {
                            "x1": cx - math.cos(angle) * half_length,
                            "y1": cy - math.sin(angle) * half_length,
                            "x2": cx + math.cos(angle) * half_length,
                            "y2": cy + math.sin(angle) * half_length,
                            "type": "checkpoint"
                        }
                    else:
                        # Nouveau format ligne
                        checkpoint = cp.copy()
                        checkpoint["type"] = "checkpoint"
                    
                    self.checkpoints.append(checkpoint)
                
                # Charger la ligne d'arrivée
                if data.get("finishLine"):
                    fl = data["finishLine"]
                    # Convertir l'ancien format si nécessaire
                    if "width" in fl:
                        cx = fl["x"] + fl["width"] / 2
                        cy = fl["y"] + fl["height"] / 2
                        angle = (fl.get("angle", 0) + 90) * math.pi / 180
                        half_length = fl["height"] / 2
                        
                        self.finish_line = {
                            "x1": cx - math.cos(angle) * half_length,
                            "y1": cy - math.sin(angle) * half_length,
                            "x2": cx + math.cos(angle) * half_length,
                            "y2": cy + math.sin(angle) * half_length,
                            "type": "finish"
                        }
                    else:
                        # Nouveau format ligne
                        self.finish_line = fl.copy()
                        self.finish_line["type"] = "finish"
                
                # Charger les spawn points
                for sp in data.get("spawnPoints", []):
                    sp["type"] = "spawnpoint"
                    sp["width"] = 30
                    sp["height"] = 20
                    self.spawnpoints.append(sp)
                
                # Charger les boosters
                for booster in data.get("boosters", []):
                    # Convertir l'ancien format rectangle en ligne si nécessaire
                    if "width" in booster:
                        # Ancien format - convertir en ligne
                        cx = booster["x"] + booster["width"] / 2
                        cy = booster["y"] + booster["height"] / 2
                        angle = booster.get("angle", 0) * math.pi / 180
                        half_length = max(booster["width"], booster["height"]) / 2
                        
                        booster_line = {
                            "x1": cx - math.cos(angle) * half_length,
                            "y1": cy - math.sin(angle) * half_length,
                            "x2": cx + math.cos(angle) * half_length,
                            "y2": cy + math.sin(angle) * half_length,
                            "type": "booster"
                        }
                        self.boosters.append(booster_line)
                    else:
                        # Nouveau format ligne
                        booster["type"] = "booster"
                        self.boosters.append(booster)
                
                # Charger les items
                for item in data.get("items", []):
                    # Convertir l'ancien format rectangle en ligne si nécessaire
                    if "width" in item:
                        # Ancien format - convertir en ligne
                        cx = item["x"] + item["width"] / 2
                        cy = item["y"] + item["height"] / 2
                        angle = item.get("angle", 0) * math.pi / 180
                        half_length = max(item["width"], item["height"]) / 2
                        
                        item_line = {
                            "x1": cx - math.cos(angle) * half_length,
                            "y1": cy - math.sin(angle) * half_length,
                            "x2": cx + math.cos(angle) * half_length,
                            "y2": cy + math.sin(angle) * half_length,
                            "type": "item"
                        }
                        self.items.append(item_line)
                    else:
                        # Nouveau format ligne
                        item["type"] = "item"
                        self.items.append(item)
                
                # Charger la ligne de course
                if "racingLine" in data:
                    self.racing_line = {
                        "points": data["racingLine"].get("points", []),
                        "totalLength": data["racingLine"].get("totalLength", 0),
                        "type": "racing_line"
                    }
                    self.log(f"Ligne de course importée avec {len(self.racing_line['points'])} points")
                
                self.redraw()
                self.update_info()
                messagebox.showinfo("Import", "Map importée avec succès !")
                
            except Exception as e:
                self.log(f"Erreur lors de l'import : {str(e)}")
                messagebox.showerror("Erreur", f"Erreur lors de l'import : {str(e)}")

    def export_json(self):
        try:
            # Convertir les courbes continues en format exportable
            continuous_curves_export = []
            for cc in self.continuous_curves:
                continuous_curves_export.append({
                    "points": cc["points"],
                    "type": "continuous",
                    "closed": cc.get("closed", False)
                })
                
            # Préparer les données selon le format demandé
            data = {
                "id": self.map_id,
                "name": self.map_name,
                "width": 1536,  # NOUVELLE RÉSOLUTION
                "height": 1024,  # NOUVELLE RÉSOLUTION
                "music": self.music_key,
                "background": self.background_key,
                "raceSettings": self.race_settings,
                "spawnPoints": [{"x": sp["x"], "y": sp["y"], "angle": sp.get("angle", 0)} 
                               for sp in self.spawnpoints],
                "walls": [{"x": r["x"], "y": r["y"], "width": r["width"], "height": r["height"], "angle": r.get("angle", 0)} 
                         for r in self.rectangles],
                "curves": [{"points": c["points"]} for c in self.curves],
                "continuousCurves": continuous_curves_export,
                "checkpoints": [{"x1": c["x1"], "y1": c["y1"], "x2": c["x2"], "y2": c["y2"]} 
                               for c in self.checkpoints],
                "finishLine": {"x1": self.finish_line["x1"], "y1": self.finish_line["y1"], "x2": self.finish_line["x2"], "y2": self.finish_line["y2"]} 
                             if self.finish_line else None,
                "boosters": [{"x1": b["x1"], "y1": b["y1"], "x2": b["x2"], "y2": b["y2"]} 
                            for b in self.boosters],
                "items": [{"x1": i["x1"], "y1": i["y1"], "x2": i["x2"], "y2": i["y2"]} 
                         for i in self.items],
                "voidZones": [{"points": vz["points"], "closed": True} 
                            for vz in self.void_zones],
                "roads": [{"x1": r["x1"], "y1": r["y1"], "x2": r["x2"], "y2": r["y2"], "width": r["width"]} 
                         for r in self.roads]
            }
            
            # Ajouter la ligne de course si elle existe
            if self.racing_line:
                # S'assurer que les points sont dans le bon format
                racing_points = []
                for point in self.racing_line["points"]:
                    if isinstance(point, tuple):
                        racing_points.append([point[0], point[1]])
                    else:
                        racing_points.append(point)
                
                data["racingLine"] = {
                    "points": racing_points,
                    "totalLength": self.racing_line.get("totalLength", 0)
                }
                self.log(f"Racing line ajoutée à l'export: {len(racing_points)} points, longueur: {self.racing_line.get('totalLength', 0):.2f}")
            else:
                self.log("Pas de ligne de course à exporter")
            
            self.log(f"Export - Murs: {len(self.rectangles)}, Courbes: {len(self.curves)}, " +
                    f"Courbes continues: {len(self.continuous_curves)}, Checkpoints: {len(self.checkpoints)}, " +
                    f"Spawns: {len(self.spawnpoints)}, Boosters: {len(self.boosters)}, Items: {len(self.items)}" +
                    (f", Ligne de course: {len(self.racing_line['points'])} points" if self.racing_line else ""))
            
            file_path = filedialog.asksaveasfilename(defaultextension=".json", 
                                                    filetypes=[("JSON files", "*.json")])
            if file_path:
                # Export avec indentation propre mais coordonnées sur une ligne
                json_str = json.dumps(data, indent=2)
                
                # Remplacer les coordonnées multi-lignes par des coordonnées sur une ligne
                import re
                
                # Pour les spawnPoints
                json_str = re.sub(r'{\s*"x":\s*(\d+),\s*"y":\s*(\d+),\s*"angle":\s*(\d+)\s*}', 
                                 r'{"x": \1, "y": \2, "angle": \3}', json_str)
                
                # Pour les walls
                json_str = re.sub(r'{\s*"x":\s*(\d+),\s*"y":\s*(\d+),\s*"width":\s*(\d+),\s*"height":\s*(\d+),\s*"angle":\s*(\d+)\s*}', 
                                 r'{"x": \1, "y": \2, "width": \3, "height": \4, "angle": \5}', json_str)
                
                # Pour les checkpoints, boosters, items et finishLine
                json_str = re.sub(r'{\s*"x1":\s*(\d+(?:\.\d+)?),\s*"y1":\s*(\d+(?:\.\d+)?),\s*"x2":\s*(\d+(?:\.\d+)?),\s*"y2":\s*(\d+(?:\.\d+)?)\s*}', 
                                 r'{"x1": \1, "y1": \2, "x2": \3, "y2": \4}', json_str)
                
                # Pour les points dans les courbes et la ligne de course - format individuel
                json_str = re.sub(r'\[\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\s*\]', r'[\1, \2]', json_str)
                
                # Pour mettre tous les tableaux de points sur une seule ligne
                # Approche plus robuste avec gestion correcte des arrays imbriqués
                def format_points_arrays(json_str):
                    lines = json_str.split('\n')
                    result = []
                    i = 0
                    
                    while i < len(lines):
                        line = lines[i].rstrip()
                        
                        # Chercher une ligne avec "points": [
                        if '"points": [' in line:
                            indent = len(line) - len(line.lstrip())
                            indent_str = ' ' * indent
                            
                            # Si la ligne se termine par ], c'est déjà sur une ligne
                            if line.rstrip().endswith(']') or line.rstrip().endswith('],'):
                                result.append(line)
                                i += 1
                                continue
                            
                            # Collecter tous les points jusqu'au ] de fermeture
                            points = []
                            i += 1
                            
                            while i < len(lines):
                                point_line = lines[i].strip()
                                
                                # Extraire les coordonnées [x, y]
                                point_match = re.match(r'\[(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\],?', point_line)
                                if point_match:
                                    x, y = point_match.groups()
                                    points.append(f'[{x}, {y}]')
                                    i += 1
                                elif point_line.startswith(']'):
                                    # Fin du tableau de points
                                    # Construire la ligne finale
                                    if points:
                                        points_str = ', '.join(points)
                                        if point_line.endswith(','):
                                            result.append(f'{indent_str}"points": [{points_str}],')
                                        else:
                                            result.append(f'{indent_str}"points": [{points_str}]')
                                    else:
                                        result.append(f'{indent_str}"points": []')
                                    
                                    # Si la ligne contient autre chose après ], l'ajouter
                                    remaining = point_line[1:].strip()
                                    if remaining and remaining != ',':
                                        result.append(indent_str + remaining)
                                    
                                    i += 1
                                    break
                                else:
                                    # Ligne inattendue, arrêter
                                    result.append(line)  # Ajouter la ligne "points": [
                                    break
                        else:
                            result.append(line)
                            i += 1
                    
                    return '\n'.join(result)
                
                # Appliquer le formatage
                json_str = format_points_arrays(json_str)
                
                # Vérifier si racingLine est dans le JSON
                if "racingLine" in json_str:
                    self.log("✓ Racing line trouvée dans le JSON exporté")
                else:
                    self.log("✗ Racing line NON trouvée dans le JSON exporté")
                
                with open(file_path, "w") as f:
                    f.write(json_str)
                
                messagebox.showinfo("Export", f"Map exportée avec succès dans {file_path}")
                self.log(f"Map exportée avec succès : {file_path}")
                
        except Exception as e:
            self.log(f"Erreur lors de l'export : {str(e)}")
            messagebox.showerror("Erreur", f"Erreur lors de l'export : {str(e)}")
            traceback.print_exc()

    def draw_road_mesh(self):
        """Draw the road segments and vertices"""
        # Draw road segments (rectangles)
        for segment in self.road_faces:
            if len(segment) == 4:
                points = []
                for v_id in segment:
                    v = self.road_mesh[v_id]
                    points.extend([v["x"], v["y"]])
                
                self.canvas.create_polygon(points, fill="#666666", outline="#333333", width=1)
        
        # Draw extrude preview
        if self.road_edit_mode == "extrude" and self.extrude_preview and len(self.selected_vertices) >= 2:
            v1 = self.road_mesh[self.selected_vertices[0]]
            v2 = self.road_mesh[self.selected_vertices[1]]
            p1 = self.extrude_preview["v1"]
            p2 = self.extrude_preview["v2"]
            
            # Draw preview face
            points = [v1["x"], v1["y"], v2["x"], v2["y"], p2["x"], p2["y"], p1["x"], p1["y"]]
            self.canvas.create_polygon(points, fill="#888888", outline="#ffff00", width=2, dash=(5, 5))
        
        # Draw vertices
        for i, vertex in enumerate(self.road_mesh):
            x, y = vertex["x"], vertex["y"]
            if i in self.selected_vertices:
                # Selected vertex
                self.canvas.create_oval(x-6, y-6, x+6, y+6, fill="#ff0000", outline="white", width=2)
            else:
                # Normal vertex - slightly larger for easier selection
                self.canvas.create_oval(x-4, y-4, x+4, y+4, fill="#666666", outline="white", width=1)
    
    def draw_road_preview(self):
        """Draw preview while creating first segment"""
        if hasattr(self, 'drag_start') and self.mouse_pos:
            x1, y1 = self.drag_start
            x2, y2 = self.mouse_pos
            
            dx = x2 - x1
            dy = y2 - y1
            length = math.sqrt(dx*dx + dy*dy)
            
            if length > 5:  # Only show if dragged far enough
                dx /= length
                dy /= length
                perp_x = -dy * self.road_width / 2
                perp_y = dx * self.road_width / 2
                
                points = [
                    x1 + perp_x, y1 + perp_y,
                    x1 - perp_x, y1 - perp_y,
                    x2 - perp_x, y2 - perp_y,
                    x2 + perp_x, y2 + perp_y
                ]
                
                # Semi-transparent preview
                self.canvas.create_polygon(points, fill="#888888", outline="#ffff00", width=2, dash=(5, 5), stipple="gray50")
    
    def start_road_extrude(self):
        """Start extruding from the selected edge"""
        if len(self.selected_vertices) >= 2 and not self.road_edit_mode:
            self.road_edit_mode = "extrude"
            self.extrude_preview = None
            self.log("Mode extrusion - Déplacez la souris et cliquez pour confirmer")
            self.update_info()
    
    def start_road_grab(self):
        """Start moving selected vertices"""
        if self.selected_vertices and not self.road_edit_mode:
            self.road_edit_mode = "grab"
            self.edit_start_pos = self.mouse_pos
            self.original_positions = [self.road_mesh[v_id].copy() for v_id in self.selected_vertices]
            self.log("Mode déplacement - Déplacez la souris et cliquez pour confirmer")
            self.update_info()
    
    def start_road_scale(self):
        """Start scaling selected vertices"""
        if self.selected_vertices and not self.road_edit_mode:
            self.road_edit_mode = "scale"
            self.edit_start_pos = self.mouse_pos
            self.original_positions = [self.road_mesh[v_id].copy() for v_id in self.selected_vertices]
            
            # Calculate center of selected vertices
            cx = sum(v["x"] for v in self.original_positions) / len(self.original_positions)
            cy = sum(v["y"] for v in self.original_positions) / len(self.original_positions)
            self.scale_center = (cx, cy)
            
            self.log("Mode échelle - Déplacez la souris verticalement")
            self.update_info()
    
    def start_road_rotate(self):
        """Start rotating selected vertices"""
        if len(self.selected_vertices) >= 2 and not self.road_edit_mode:
            self.road_edit_mode = "rotate"
            self.edit_start_pos = self.mouse_pos
            self.original_positions = [self.road_mesh[v_id].copy() for v_id in self.selected_vertices]
            
            # Calculate center of selected vertices
            cx = sum(v["x"] for v in self.original_positions) / len(self.original_positions)
            cy = sum(v["y"] for v in self.original_positions) / len(self.original_positions)
            self.rotation_center = (cx, cy)
            
            self.log("Mode rotation - Déplacez la souris pour tourner")
            self.update_info()
    
    def start_road_curve(self):
        """Create a curved corner from selected edge"""
        if len(self.selected_vertices) >= 2 and not self.road_edit_mode:
            # Instead of a special mode, directly create curved segments
            self.create_curved_corner()
    
    def create_curved_corner(self, segments=3):
        """Create multiple segments to form a smooth curve"""
        if len(self.selected_vertices) < 2:
            return
        
        # Get the current edge
        v1_id = self.selected_vertices[0]
        v2_id = self.selected_vertices[1]
        v1 = self.road_mesh[v1_id]
        v2 = self.road_mesh[v2_id]
        
        # Find the previous segment to determine curve direction
        # Look for vertices that connect to our selected edge
        prev_vertices = []
        for face in self.road_faces:
            if v1_id in face and v2_id in face:
                # Find the other two vertices of this face
                for v in face:
                    if v != v1_id and v != v2_id:
                        prev_vertices.append(v)
        
        if len(prev_vertices) >= 2:
            # Calculate the direction from previous segment
            pv1 = self.road_mesh[prev_vertices[0]]
            pv2 = self.road_mesh[prev_vertices[1]]
            
            # Previous segment center to current edge center
            prev_center_x = (pv1["x"] + pv2["x"]) / 2
            prev_center_y = (pv1["y"] + pv2["y"]) / 2
            curr_center_x = (v1["x"] + v2["x"]) / 2
            curr_center_y = (v1["y"] + v2["y"]) / 2
            
            # Direction of travel
            travel_dx = curr_center_x - prev_center_x
            travel_dy = curr_center_y - prev_center_y
            travel_dist = math.sqrt(travel_dx*travel_dx + travel_dy*travel_dy)
            
            if travel_dist > 0:
                travel_dx /= travel_dist
                travel_dy /= travel_dist
                
                # Create curved segments
                angle_step = math.pi / (2 * segments)  # 90 degree turn divided by segments
                base_dist = self.road_width  # Distance for each segment
                
                last_v1 = v1_id
                last_v2 = v2_id
                
                for i in range(segments):
                    # Calculate angle for this segment
                    angle = angle_step * (i + 1)
                    
                    # Rotate travel direction
                    cos_a = math.cos(angle)
                    sin_a = math.sin(angle)
                    new_dx = travel_dx * cos_a - travel_dy * sin_a
                    new_dy = travel_dx * sin_a + travel_dy * cos_a
                    
                    # Create new vertices
                    new_v1_id = len(self.road_mesh)
                    new_v2_id = new_v1_id + 1
                    
                    # Position new vertices
                    segment_dist = base_dist * 0.7  # Slightly shorter segments for smoother curve
                    new_center_x = curr_center_x + new_dx * segment_dist * (i + 1)
                    new_center_y = curr_center_y + new_dy * segment_dist * (i + 1)
                    
                    # Calculate perpendicular for road width
                    perp_x = -new_dy * self.road_width / 2
                    perp_y = new_dx * self.road_width / 2
                    
                    self.road_mesh.append({
                        "x": new_center_x + perp_x,
                        "y": new_center_y + perp_y,
                        "id": new_v1_id
                    })
                    self.road_mesh.append({
                        "x": new_center_x - perp_x,
                        "y": new_center_y - perp_y,
                        "id": new_v2_id
                    })
                    
                    # Create edges
                    self.road_edges.extend([
                        (last_v1, new_v1_id),
                        (last_v2, new_v2_id),
                        (new_v1_id, new_v2_id)
                    ])
                    
                    # Create face
                    self.road_faces.append((last_v1, last_v2, new_v2_id, new_v1_id))
                    
                    # Update for next iteration
                    last_v1 = new_v1_id
                    last_v2 = new_v2_id
                
                # Select the last edge for further building
                self.selected_vertices = [last_v1, last_v2]
                
                self.log(f"Virage créé avec {segments} segments")
                self.update_info()
                self.redraw()
    
    def confirm_road_operation(self):
        """Confirm the current road operation"""
        if self.road_edit_mode == "extrude" and self.extrude_preview:
            # Create new vertices from extrusion
            if len(self.selected_vertices) >= 2:
                v1_old = self.selected_vertices[0]
                v2_old = self.selected_vertices[1]
                
                # Add new vertices
                v1_new = len(self.road_mesh)
                v2_new = v1_new + 1
                
                self.road_mesh.append({
                    "x": self.extrude_preview["v1"]["x"],
                    "y": self.extrude_preview["v1"]["y"],
                    "id": v1_new
                })
                self.road_mesh.append({
                    "x": self.extrude_preview["v2"]["x"],
                    "y": self.extrude_preview["v2"]["y"],
                    "id": v2_new
                })
                
                # Create new edges
                self.road_edges.extend([
                    (v1_old, v1_new),  # Side edge 1
                    (v2_old, v2_new),  # Side edge 2
                    (v1_new, v2_new),  # New end edge
                ])
                
                # Create new road segment
                self.road_faces.append((v1_old, v2_old, v2_new, v1_new))
                
                # Select the new edge for next extrusion
                self.selected_vertices = [v1_new, v2_new]
                
                self.log("Segment extrudé")
        
        self.road_edit_mode = None
        self.extrude_preview = None
        self.update_info()
        self.redraw()
    
    def cancel_road_operation(self):
        """Cancel current road operation"""
        if self.road_edit_mode in ["grab", "scale", "rotate"] and hasattr(self, 'original_positions'):
            # Restore original positions
            for i, v_id in enumerate(self.selected_vertices):
                self.road_mesh[v_id] = self.original_positions[i]
        
        self.road_edit_mode = None
        self.extrude_preview = None
        self.update_info()
        self.redraw()
    
    def select_road_vertices(self, x, y, shift_held=False):
        """Select vertices near click point"""
        threshold = 10
        
        if not shift_held:
            # Clear selection if shift not held
            self.selected_vertices = []
        
        # Find vertices near click point
        for i, vertex in enumerate(self.road_mesh):
            dist = math.sqrt((vertex["x"] - x)**2 + (vertex["y"] - y)**2)
            if dist < threshold:
                if i in self.selected_vertices and shift_held:
                    # Toggle off if already selected with shift
                    self.selected_vertices.remove(i)
                elif i not in self.selected_vertices:
                    # Add to selection
                    self.selected_vertices.append(i)
        
        self.update_info()
        self.redraw()

if __name__ == "__main__":
    try:
        print("Création de la fenêtre Tkinter...")
        root = tk.Tk()
        print("Création de l'application MapEditor...")
        app = MapEditor(root)
        print("Lancement de la boucle principale...")
        root.mainloop()
    except Exception as e:
        print(f"ERREUR FATALE: {str(e)}")
        traceback.print_exc()
        input("Appuyez sur Entrée pour fermer...")